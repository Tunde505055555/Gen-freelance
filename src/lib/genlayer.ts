// MetaMask-only GenLayer client helpers. No burner wallets, no mock signing.
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

// Deployed on GenLayer Studionet. Fixed constant — not user-editable.
export const CONTRACT_ADDRESS = "0xB1ca2B7eAda9d77C358037A422F8085731c0F669" as const;

// Studionet chain id 61999 = 0xF22F
const STUDIONET_CHAIN_ID_HEX = "0xf22f";
const STUDIONET_RPC = "https://studio.genlayer.com/api";

// -----------------------------------------------------------------
// Ethereum provider (MetaMask) helpers
// -----------------------------------------------------------------
type EthProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, cb: (...a: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...a: unknown[]) => void) => void;
  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export function hasMetaMask(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function ensureStudionet(): Promise<void> {
  const eth = window.ethereum;
  if (!eth) throw new Error("MetaMask not detected");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: STUDIONET_CHAIN_ID_HEX,
            chainName: "GenLayer Studionet",
            nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
            rpcUrls: [STUDIONET_RPC],
            blockExplorers: undefined,
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

export async function connectMetaMask(): Promise<string> {
  if (!hasMetaMask()) throw new Error("MetaMask not detected. Install MetaMask to continue.");
  const eth = window.ethereum!;
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("No account authorized");
  await ensureStudionet();
  return accounts[0];
}

export async function getConnectedAddress(): Promise<string | null> {
  if (!hasMetaMask()) return null;
  const accounts = (await window.ethereum!.request({ method: "eth_accounts" })) as string[];
  return accounts && accounts.length > 0 ? accounts[0] : null;
}

export function onAccountsChanged(cb: (addr: string | null) => void) {
  if (!hasMetaMask() || !window.ethereum!.on) return () => {};
  const handler = (...args: unknown[]) => {
    const list = args[0] as string[] | undefined;
    cb(list && list.length > 0 ? list[0] : null);
  };
  window.ethereum!.on!("accountsChanged", handler);
  return () => window.ethereum!.removeListener?.("accountsChanged", handler);
}

// -----------------------------------------------------------------
// Client factory
// -----------------------------------------------------------------
function makeClient(address?: string) {
  // Passing a plain address string (not an Account object) routes signing
  // methods through window.ethereum (MetaMask) inside genlayer-js.
  return createClient({
    chain: studionet,
    account: address as `0x${string}` | undefined,
  });
}

// -----------------------------------------------------------------
// Job / message types
// -----------------------------------------------------------------
export type Job = {
  id: string;
  client: string;
  freelancer: string;
  title: string;
  description: string;
  deliverables: string;
  deadline: string;
  budget: string;
  status:
    | "open"
    | "in_progress"
    | "submitted"
    | "completed"
    | "disputed"
    | "resolved"
    | "finalized"
    | "cancelled";
  source_repo: string;
  commit_sha: string;
  deployed_url: string;
  proof: string;
  submitted_at: string;
  submitted_date: string;
  dispute_opened_date: string;
  ai_verdict: string;
  ai_rationale: string;
  ai_evidence: string;
  completeness: string;
  quality: string;
  client_share_bps: string;
  freelancer_share_bps: string;
  resolved: string;
  closed_reason: string;
};

export const TIMEOUTS = {
  reviewWindowDays: 7,
  deliveryGraceDays: 7,
  disputeTimeoutDays: 14,
} as const;

/** Full 40-char hex commit hash — submissions are pinned to immutable source. */
export function isValidCommitSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/.test((sha || "").trim().toLowerCase());
}

/** Whole UTC days elapsed since an ISO date (YYYY-MM-DD...), or null. */
export function daysSince(isoDate: string): number | null {
  if (!isoDate || isoDate.length < 10) return null;
  const t = Date.parse(isoDate.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

const SOURCE_HOSTS = [
  "github.com/",
  "gitlab.com/",
  "bitbucket.org/",
  "codeberg.org/",
  "git.sr.ht/",
];

export function isValidSourceRepo(url: string): boolean {
  if (!url) return false;
  const lo = url.trim().toLowerCase();
  if (!lo.startsWith("http://") && !lo.startsWith("https://")) return false;
  for (const h of SOURCE_HOSTS) {
    const i = lo.indexOf(h);
    if (i === -1) continue;
    const parts = lo
      .slice(i + h.length)
      .split("/")
      .filter(Boolean);
    if (parts.length >= 2) return true;
  }
  return false;
}

// -----------------------------------------------------------------
// Reads
// -----------------------------------------------------------------
export async function readJobs(): Promise<Job[]> {
  const client = makeClient();
  const raw = (await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_jobs",
    args: [],
  })) as string;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function readMessages(jobId: string): Promise<Array<{ from: string; body: string }>> {
  const client = makeClient();
  const raw = (await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_messages",
    args: [jobId],
  })) as string;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function readOwner(): Promise<string> {
  const client = makeClient();
  return (await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_owner",
    args: [],
  })) as string;
}

// -----------------------------------------------------------------
// Writes (signed by MetaMask)
// -----------------------------------------------------------------
export async function callWrite(
  address: string,
  functionName: string,
  args: (string | number | bigint)[] = [],
  value: bigint = 0n,
) {
  if (!address) throw new Error("Connect MetaMask first");
  await ensureStudionet();
  const client = makeClient(address);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never,
    value,
  });
  try {
    // @ts-expect-error waitForTransactionReceipt exists on genlayer client
    await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" });
  } catch {
    /* ignore polling errors */
  }
  return hash;
}

// -----------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------
export function shortAddr(a: string) {
  if (!a) return "—";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function sameAddr(a: string, b: string) {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}
