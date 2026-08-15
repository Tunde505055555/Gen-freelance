import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Toaster } from "sonner";
import {
  Briefcase,
  Plus,
  RefreshCw,
  Wallet,
  Copy,
  Gavel,
  Send,
  Check,
  X,
  Sparkles,
  Loader2,
  ShieldCheck,
  Clock,
} from "lucide-react";
import {
  CONTRACT_ADDRESS,
  callWrite,
  connectMetaMask,
  getConnectedAddress,
  hasMetaMask,
  isValidSourceRepo,
  isValidCommitSha,
  daysSince,
  TIMEOUTS,
  onAccountsChanged,
  readJobs,
  readMessages,
  readOwner,
  sameAddr,
  shortAddr,
  type Job,
} from "@/lib/genlayer";
import { runAiReview, type AiReviewResult } from "@/lib/ai-review.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GenEscrow — AI Reputation Escrow for Freelancers" },
      {
        name: "description",
        content:
          "Post freelance jobs, lock funds in escrow, and let GenLayer validators resolve disputes with an AI oracle.",
      },
      { property: "og:title", content: "GenEscrow — AI Reputation Escrow" },
      {
        property: "og:description",
        content: "Trustless freelance escrow with AI-adjudicated dispute resolution on GenLayer.",
      },
    ],
  }),
  component: Index,
});

const STATUS_VARIANT: Record<Job["status"], string> = {
  open: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  submitted: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  disputed: "bg-red-500/15 text-red-400 border-red-500/30",
  resolved: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  finalized: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  cancelled: "bg-zinc-700/40 text-zinc-400 border-zinc-600/30",
};

function Index() {
  const [address, setAddress] = useState<string>("");
  const [owner, setOwner] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  useEffect(() => {
    getConnectedAddress().then((a) => a && setAddress(a));
    const off = onAccountsChanged((a) => setAddress(a ?? ""));
    return off;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [j, o] = await Promise.all([readJobs(), readOwner()]);
      setJobs(j.slice().reverse());
      setOwner(o);
    } catch (e) {
      console.error(e);
      toast.error("Could not load contract data. Check the RPC / address.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const myAddr = address;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-zinc-100">
      <Toaster theme="dark" richColors position="top-right" />

      <header className="border-b border-white/5 bg-black/40 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-black" />
            </div>
            <div>
              <div className="font-semibold tracking-tight">GenEscrow</div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                AI reputation escrow · GenLayer
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWalletOpen(true)}
              className="gap-2"
            >
              <Wallet className="h-4 w-4" />
              {myAddr ? shortAddr(myAddr) : "Wallet"}
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-2 bg-emerald-500 text-black hover:bg-emerald-400"
            >
              <Plus className="h-4 w-4" />
              Post job
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <section className="mb-8">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Trustless freelance work,{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              adjudicated by AI validators
            </span>
          </h1>
          <p className="text-zinc-400 mt-2 max-w-2xl">
            Clients lock a budget in escrow. Freelancers deliver proof of work. If there is a
            dispute, GenLayer validators run an equivalence- principle LLM oracle and reach
            consensus on the payout split.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Contract{" "}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(CONTRACT_ADDRESS);
                  toast.success("Address copied");
                }}
                className="font-mono text-zinc-200 hover:text-white"
              >
                {shortAddr(CONTRACT_ADDRESS)} <Copy className="inline h-3 w-3" />
              </button>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Owner {shortAddr(owner)}
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Network Studionet
            </div>
          </div>
        </section>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="all">All jobs</TabsTrigger>
            <TabsTrigger value="mine-client">Posted by me</TabsTrigger>
            <TabsTrigger value="mine-freelancer">My work</TabsTrigger>
            <TabsTrigger value="disputed">Disputes</TabsTrigger>
          </TabsList>

          {(["all", "mine-client", "mine-freelancer", "disputed"] as const).map((tab) => {
            const list = jobs.filter((j) => {
              if (tab === "mine-client") return sameAddr(j.client, myAddr);
              if (tab === "mine-freelancer") return sameAddr(j.freelancer, myAddr);
              if (tab === "disputed") return j.status === "disputed" || j.status === "resolved";
              return true;
            });
            return (
              <TabsContent key={tab} value={tab} className="mt-6">
                {list.length === 0 ? (
                  <EmptyState onCreate={() => setCreateOpen(true)} loading={loading} />
                ) : (
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {list.map((j) => (
                      <JobCard key={j.id} job={j} myAddr={myAddr} onOpen={() => setOpenJob(j)} />
                    ))}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </main>

      <footer className="border-t border-white/5 mt-16 py-6 text-center text-xs text-zinc-500">
        Built on GenLayer. Payouts settle in GEN wei.
      </footer>

      <CreateJobDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        address={address}
        onCreated={refresh}
      />

      <WalletDialog
        open={walletOpen}
        onOpenChange={setWalletOpen}
        address={address}
        setAddress={setAddress}
      />

      <JobDialog
        job={openJob}
        onOpenChange={(o) => !o && setOpenJob(null)}
        address={address}
        myAddr={myAddr}
        onChanged={async () => {
          await refresh();
          if (openJob) {
            const fresh = (await readJobs()).find((x) => x.id === openJob.id);
            if (fresh) setOpenJob(fresh);
          }
        }}
      />
    </div>
  );
}

function EmptyState({ onCreate, loading }: { onCreate: () => void; loading: boolean }) {
  return (
    <div className="border border-dashed border-white/10 rounded-2xl py-16 text-center bg-white/[0.02]">
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-zinc-500" />
      ) : (
        <>
          <Briefcase className="h-8 w-8 mx-auto text-zinc-600" />
          <div className="mt-3 text-zinc-300">No jobs yet</div>
          <div className="text-sm text-zinc-500">Be the first to post a bounty.</div>
          <Button
            onClick={onCreate}
            className="mt-4 bg-emerald-500 text-black hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4 mr-1" /> Post a job
          </Button>
        </>
      )}
    </div>
  );
}

function JobCard({ job, myAddr, onOpen }: { job: Job; myAddr: string; onOpen: () => void }) {
  const isClient = sameAddr(job.client, myAddr);
  const isFreelancer = sameAddr(job.freelancer, myAddr);
  return (
    <button
      onClick={onOpen}
      className="text-left group border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04] rounded-2xl p-4 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium line-clamp-1">{job.title || "Untitled"}</div>
        <Badge variant="outline" className={`border ${STATUS_VARIANT[job.status]} capitalize`}>
          {job.status.replace("_", " ")}
        </Badge>
      </div>
      <div className="text-sm text-zinc-400 mt-1 line-clamp-2 min-h-[2.5rem]">
        {job.description}
      </div>
      <Separator className="my-3 bg-white/5" />
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <div>
          <div>Budget</div>
          <div className="text-emerald-400 font-mono">{formatWei(job.budget)} GEN</div>
        </div>
        <div className="text-right">
          <div>Deadline</div>
          <div className="text-zinc-300">{job.deadline || "—"}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-[10px]">
        {isClient && (
          <span className="rounded-full bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border border-emerald-500/20">
            you are client
          </span>
        )}
        {isFreelancer && (
          <span className="rounded-full bg-cyan-500/10 text-cyan-300 px-2 py-0.5 border border-cyan-500/20">
            you are freelancer
          </span>
        )}
      </div>
    </button>
  );
}

function formatWei(v: string) {
  try {
    const n = BigInt(v || "0");
    if (n === 0n) return "0";
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    const s = (n * 10000n) / 10n ** 18n;
    return (Number(s) / 10000).toString();
  } catch {
    return v || "0";
  }
}

function toWei(gen: string): bigint {
  if (!gen) return 0n;
  const [w, f = ""] = gen.split(".");
  const frac = (f + "000000000000000000").slice(0, 18);
  return BigInt(w || "0") * 10n ** 18n + BigInt(frac || "0");
}

function CreateJobDialog({
  open,
  onOpenChange,
  address,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  address: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [deadline, setDeadline] = useState("");
  const [budget, setBudget] = useState("0.01");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!address) return toast.error("Connect MetaMask first");
    if (!title.trim()) return toast.error("Title is required");
    const value = toWei(budget);
    if (value <= 0n) return toast.error("Budget must be > 0");
    setBusy(true);
    try {
      await callWrite(address, "create_job", [title, description, deliverables, deadline], value);
      toast.success("Job posted & funds escrowed");
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setDeliverables("");
      setDeadline("");
      onCreated();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Failed: " + msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-white/10 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>Post a job</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Funds are locked in the contract until the work is approved or a dispute is resolved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Landing page for SaaS product"
              className="bg-black/40 border-white/10"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you need built and any context"
              className="bg-black/40 border-white/10 min-h-[80px]"
            />
          </Field>
          <Field label="Deliverables">
            <Textarea
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
              placeholder="Deployed URL, Figma link, GitHub repo, Loom video…"
              className="bg-black/40 border-white/10"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deadline">
              <Input
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                type="date"
                className="bg-black/40 border-white/10"
              />
            </Field>
            <Field label="Budget (GEN)">
              <Input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                type="number"
                step="0.001"
                className="bg-black/40 border-white/10"
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy}
            className="bg-emerald-500 text-black hover:bg-emerald-400"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Lock {budget} GEN & post</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-zinc-500">{label}</Label>
      {children}
    </div>
  );
}

function WalletDialog({
  open,
  onOpenChange,
  address,
  setAddress,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  address: string;
  setAddress: (a: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const installed = hasMetaMask();

  async function doConnect() {
    setBusy(true);
    try {
      const a = await connectMetaMask();
      setAddress(a);
      toast.success("Connected " + shortAddr(a));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-white/10 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle>Connect MetaMask</DialogTitle>
          <DialogDescription className="text-zinc-500">
            All transactions are signed by your MetaMask wallet on the GenLayer Studionet network
            (chain id 61999). No burner keys are stored in the browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {address ? (
            <Field label="Connected address">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={address}
                  className="bg-black/40 border-white/10 font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(address);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </Field>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-zinc-400">
              {installed
                ? "MetaMask detected. Click Connect to sign in and switch to Studionet."
                : "MetaMask is not installed. Install the MetaMask browser extension, then reload this page."}
            </div>
          )}
        </div>
        <DialogFooter>
          {!installed && (
            <Button asChild variant="outline">
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                Get MetaMask
              </a>
            </Button>
          )}
          <Button
            onClick={doConnect}
            disabled={busy || !installed}
            className="bg-emerald-500 text-black hover:bg-emerald-400"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : address ? (
              "Re-connect"
            ) : (
              "Connect MetaMask"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobDialog({
  job,
  onOpenChange,
  address,
  myAddr,
  onChanged,
}: {
  job: Job | null;
  onOpenChange: (o: boolean) => void;
  address: string;
  myAddr: string;
  onChanged: () => void | Promise<void>;
}) {
  const [messages, setMessages] = useState<Array<{ from: string; body: string }>>([]);
  const [msg, setMsg] = useState("");
  const [proof, setProof] = useState("");
  const [sourceRepo, setSourceRepo] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [deployedUrl, setDeployedUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!job) return;
    readMessages(job.id)
      .then(setMessages)
      .catch(() => setMessages([]));
    setProof(job.proof || "");
    setSourceRepo(job.source_repo || "");
    setCommitSha(job.commit_sha || "");
    setDeployedUrl(job.deployed_url || "");
    setAiReview(null);
  }, [job]);

  if (!job) return null;

  const isClient = sameAddr(job.client, myAddr);
  const isFreelancer = sameAddr(job.freelancer, myAddr);
  const canParticipate = isClient || isFreelancer;

  async function run(name: string, fn: () => Promise<unknown>) {
    if (!address) return toast.error("Connect MetaMask first");
    setBusy(name);
    try {
      await fn();
      toast.success(name + " ✓");
      await onChanged();
      if (job) {
        const fresh = await readMessages(job.id);
        setMessages(fresh);
      }
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      toast.error(name + " failed: " + m.slice(0, 200));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-white/10 text-zinc-100 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-xl">{job.title}</DialogTitle>
            <Badge variant="outline" className={`border ${STATUS_VARIANT[job.status]} capitalize`}>
              {job.status.replace("_", " ")}
            </Badge>
          </div>
          <DialogDescription className="text-zinc-500">
            Job #{job.id} · Deadline {job.deadline || "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="Client" value={shortAddr(job.client)} />
          <Info
            label="Freelancer"
            value={job.freelancer ? shortAddr(job.freelancer) : "unassigned"}
          />
          <Info
            label="Budget"
            value={<span className="text-emerald-400 font-mono">{formatWei(job.budget)} GEN</span>}
          />
          <Info label="Submitted" value={job.submitted_date || job.submitted_at || "—"} />
        </div>

        <Section title="Description">{job.description || "—"}</Section>
        <Section title="Deliverables">{job.deliverables || "—"}</Section>

        {(job.source_repo || job.proof || isFreelancer) && (
          <Section title="Proof of work">
            {isFreelancer && (job.status === "in_progress" || job.status === "disputed") ? (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-zinc-400">
                    Source repository URL <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    value={sourceRepo}
                    onChange={(e) => setSourceRepo(e.target.value)}
                    placeholder="https://github.com/you/project"
                    className="bg-black/40 border-white/10 mt-1"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Required. Must be a public GitHub / GitLab / Bitbucket / Codeberg / SourceHut
                    repo. Deploy-only links are rejected on-chain — validators fetch this URL to
                    verify your work.
                  </p>
                  {sourceRepo && !isValidSourceRepo(sourceRepo) && (
                    <p className="text-[11px] text-red-400 mt-1">
                      Not a recognized source-hosting URL.
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-zinc-400">
                    Commit SHA <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    value={commitSha}
                    onChange={(e) => setCommitSha(e.target.value)}
                    placeholder="40-character commit hash, e.g. 9fceb02…"
                    className="bg-black/40 border-white/10 mt-1 font-mono text-xs"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Required. Your submission is pinned to this immutable commit — validators fetch
                    the commit metadata, the full file tree and the README at this exact SHA, so it
                    cannot be changed after submission.
                  </p>
                  {commitSha && !isValidCommitSha(commitSha) && (
                    <p className="text-[11px] text-red-400 mt-1">
                      Must be a full 40-character hex commit hash (not a short SHA or branch name).
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-zinc-400">Deployed URL (optional)</Label>
                  <Input
                    value={deployedUrl}
                    onChange={(e) => setDeployedUrl(e.target.value)}
                    placeholder="https://your-app.vercel.app"
                    className="bg-black/40 border-white/10 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-zinc-400">Notes (Figma, Loom, screenshots…)</Label>
                  <Textarea
                    value={proof}
                    onChange={(e) => setProof(e.target.value)}
                    placeholder="Anything else the reviewer should see"
                    className="bg-black/40 border-white/10 mt-1"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {job.source_repo && (
                  <div>
                    <span className="text-zinc-500">Source: </span>
                    <a
                      href={job.source_repo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 underline break-all"
                    >
                      {job.source_repo}
                    </a>
                  </div>
                )}
                {job.commit_sha && (
                  <div>
                    <span className="text-zinc-500">Pinned commit: </span>
                    <span className="font-mono text-xs text-zinc-300 break-all">
                      {job.commit_sha}
                    </span>
                  </div>
                )}
                {job.deployed_url && (
                  <div>
                    <span className="text-zinc-500">Deployed: </span>
                    <a
                      href={job.deployed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline break-all"
                    >
                      {job.deployed_url}
                    </a>
                  </div>
                )}
                {job.proof && <div className="whitespace-pre-wrap text-zinc-300">{job.proof}</div>}
                {!job.source_repo && !job.proof && <div className="text-zinc-500">—</div>}
              </div>
            )}
          </Section>
        )}

        {job.ai_verdict && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-purple-300">
              <Sparkles className="h-4 w-4" /> AI validator verdict
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Info label="Verdict" value={job.ai_verdict} />
              <Info label="Completeness" value={job.completeness + "/100"} />
              <Info label="Quality" value={job.quality + "/100"} />
              <Info
                label="Freelancer"
                value={(Number(job.freelancer_share_bps) / 100).toFixed(1) + "%"}
              />
              <Info label="Client" value={(Number(job.client_share_bps) / 100).toFixed(1) + "%"} />
              <Info label="Resolved" value={job.resolved} />
            </div>
            {job.ai_evidence && (
              <div className="rounded-lg border border-purple-500/20 bg-black/30 p-2 text-xs text-purple-200/90 whitespace-pre-wrap">
                <div className="text-[10px] uppercase tracking-wide text-purple-400 mb-1">
                  Fetched evidence
                </div>
                {job.ai_evidence}
              </div>
            )}
            {job.ai_rationale && (
              <div className="text-sm text-zinc-300 whitespace-pre-wrap">{job.ai_rationale}</div>
            )}
          </div>
        )}

        {/* AI Reviewer */}
        <AiReviewerPanel
          job={job}
          messages={messages}
          isFreelancer={isFreelancer}
          isClient={isClient}
          aiReview={aiReview}
          setAiReview={setAiReview}
          aiBusy={aiBusy}
          setAiBusy={setAiBusy}
          currentProof={proof}
          onSendMessage={async (body) => {
            await run("Send", async () => {
              await callWrite(address, "post_message", [job.id, body]);
            });
          }}
          onOpenDispute={async () => {
            await run("Dispute", () => callWrite(address, "open_dispute", [job.id]));
          }}
          onApprove={async () => {
            await run("Approve", () => callWrite(address, "approve_and_release", [job.id]));
          }}
          canApprove={isClient && job.status === "submitted"}
          canDispute={
            (isClient || isFreelancer) &&
            (job.status === "submitted" || job.status === "in_progress")
          }
        />

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {job.status === "open" && !isClient && (
            <ActionBtn
              busy={busy}
              name="Accept"
              icon={<Check className="h-4 w-4" />}
              onClick={() => run("Accept", () => callWrite(address, "accept_job", [job.id]))}
            />
          )}
          {job.status === "open" && isClient && (
            <ActionBtn
              busy={busy}
              name="Cancel & refund"
              destructive
              icon={<X className="h-4 w-4" />}
              onClick={() => run("Cancel", () => callWrite(address, "cancel_open_job", [job.id]))}
            />
          )}
          {isFreelancer && (job.status === "in_progress" || job.status === "disputed") && (
            <ActionBtn
              busy={busy}
              name="Submit work"
              icon={<Send className="h-4 w-4" />}
              onClick={() => {
                if (!isValidCommitSha(commitSha)) {
                  toast.error(
                    "A full 40-character commit SHA is required — submissions are pinned to immutable source.",
                  );
                  return;
                }
                if (!isValidSourceRepo(sourceRepo)) {
                  toast.error(
                    "A public GitHub/GitLab/Bitbucket/Codeberg/SourceHut repo URL is required — deploy-only links are rejected on-chain.",
                  );
                  return;
                }
                run("Submit", () =>
                  callWrite(address, "submit_work", [
                    job.id,
                    sourceRepo.trim(),
                    commitSha.trim().toLowerCase(),
                    deployedUrl.trim(),
                    proof,
                    new Date().toISOString(),
                  ]),
                );
              }}
            />
          )}
          {isClient && job.status === "submitted" && (
            <ActionBtn
              busy={busy}
              name="Approve & release"
              icon={<Check className="h-4 w-4" />}
              onClick={() =>
                run("Approve", () => callWrite(address, "approve_and_release", [job.id]))
              }
            />
          )}
          {canParticipate && (job.status === "submitted" || job.status === "in_progress") && (
            <ActionBtn
              busy={busy}
              name="Open dispute"
              destructive
              icon={<Gavel className="h-4 w-4" />}
              onClick={() => run("Dispute", () => callWrite(address, "open_dispute", [job.id]))}
            />
          )}
          {job.status === "disputed" && (
            <ActionBtn
              busy={busy}
              name="Run AI review"
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => run("AI review", () => callWrite(address, "review_dispute", [job.id]))}
            />
          )}
          {job.status === "resolved" && (
            <ActionBtn
              busy={busy}
              name="Finalize payout"
              icon={<Check className="h-4 w-4" />}
              onClick={() =>
                run("Finalize", () => callWrite(address, "finalize_resolved", [job.id]))
              }
            />
          )}
          <TimeoutActions job={job} busy={busy} run={run} address={address} />
        </div>

        {/* Chat */}
        {canParticipate && (
          <div className="border border-white/10 rounded-xl p-3 space-y-3 bg-white/[0.02]">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Conversation (visible to AI on dispute)
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {messages.length === 0 && (
                <div className="text-xs text-zinc-500">No messages yet.</div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-lg px-3 py-2 border ${
                    sameAddr(m.from, myAddr)
                      ? "bg-emerald-500/10 border-emerald-500/20 ml-8"
                      : "bg-white/5 border-white/10 mr-8"
                  }`}
                >
                  <div className="text-[10px] text-zinc-500 font-mono">{shortAddr(m.from)}</div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Message the other party…"
                className="bg-black/40 border-white/10"
              />
              <Button
                disabled={!msg.trim() || busy === "Send"}
                onClick={() =>
                  run("Send", async () => {
                    await callWrite(address, "post_message", [job.id, msg]);
                    setMsg("");
                  })
                }
              >
                Send
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm text-zinc-200 font-mono truncate">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">{title}</div>
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-zinc-200 whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

function TimeoutActions({
  job,
  busy,
  run,
  address,
}: {
  job: Job;
  busy: string | null;
  run: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
  address: string;
}) {
  const reviewDays = daysSince(job.submitted_date);
  const disputeDays = daysSince(job.dispute_opened_date);
  const deadlineDays = daysSince(job.deadline);

  const canReviewTimeout =
    job.status === "submitted" && reviewDays !== null && reviewDays >= TIMEOUTS.reviewWindowDays;
  const canDeliveryTimeout =
    job.status === "in_progress" &&
    deadlineDays !== null &&
    deadlineDays >= TIMEOUTS.deliveryGraceDays;
  const canDisputeTimeout =
    job.status === "disputed" && disputeDays !== null && disputeDays >= TIMEOUTS.disputeTimeoutDays;

  if (!canReviewTimeout && !canDeliveryTimeout && !canDisputeTimeout) return null;

  return (
    <>
      {canReviewTimeout && (
        <ActionBtn
          busy={busy}
          name="Release (review timeout)"
          icon={<Clock className="h-4 w-4" />}
          onClick={() =>
            run("Release (review timeout)", () =>
              callWrite(address, "claim_after_review_timeout", [job.id]),
            )
          }
        />
      )}
      {canDeliveryTimeout && (
        <ActionBtn
          busy={busy}
          name="Refund (delivery timeout)"
          destructive
          icon={<Clock className="h-4 w-4" />}
          onClick={() =>
            run("Refund (delivery timeout)", () =>
              callWrite(address, "refund_after_delivery_timeout", [job.id]),
            )
          }
        />
      )}
      {canDisputeTimeout && (
        <ActionBtn
          busy={busy}
          name="Split (dispute timeout)"
          destructive
          icon={<Clock className="h-4 w-4" />}
          onClick={() =>
            run("Split (dispute timeout)", () =>
              callWrite(address, "split_after_dispute_timeout", [job.id]),
            )
          }
        />
      )}
    </>
  );
}

function ActionBtn({
  name,
  onClick,
  busy,
  icon,
  destructive,
}: {
  name: string;
  onClick: () => void;
  busy: string | null;
  icon?: React.ReactNode;
  destructive?: boolean;
}) {
  const isBusy = busy === name;
  return (
    <Button
      onClick={onClick}
      disabled={!!busy}
      variant={destructive ? "outline" : "default"}
      className={
        destructive
          ? "border-red-500/40 text-red-300 hover:bg-red-500/10"
          : "bg-emerald-500 text-black hover:bg-emerald-400"
      }
    >
      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      <span className="ml-1">{name}</span>
    </Button>
  );
}

function AiReviewerPanel({
  job,
  messages,
  isFreelancer,
  isClient,
  aiReview,
  setAiReview,
  aiBusy,
  setAiBusy,
  currentProof,
  onSendMessage,
  onOpenDispute,
  onApprove,
  canApprove,
  canDispute,
}: {
  job: Job;
  messages: Array<{ from: string; body: string }>;
  isFreelancer: boolean;
  isClient: boolean;
  aiReview: AiReviewResult | null;
  setAiReview: (r: AiReviewResult | null) => void;
  aiBusy: boolean;
  setAiBusy: (b: boolean) => void;
  currentProof: string;
  onSendMessage: (body: string) => Promise<void>;
  onOpenDispute: () => Promise<void> | void;
  onApprove: () => Promise<void> | void;
  canApprove: boolean;
  canDispute: boolean;
}) {
  const mode: "freelancer_precheck" | "client_review" | "dispute_review" =
    job.status === "disputed" || job.status === "resolved"
      ? "dispute_review"
      : isFreelancer && (job.status === "in_progress" || job.status === "open")
        ? "freelancer_precheck"
        : "client_review";

  const modeLabel =
    mode === "freelancer_precheck"
      ? "Pre-submission check"
      : mode === "dispute_review"
        ? "Dispute review"
        : "Submission review";

  async function analyze() {
    setAiBusy(true);
    setAiReview(null);
    try {
      const result = await runAiReview({
        data: {
          mode,
          title: job.title,
          description: job.description,
          deliverables: job.deliverables,
          deadline: job.deadline,
          budget: job.budget,
          status: job.status,
          proof: currentProof || job.proof,
          submitted_at: job.submitted_at,
          messages,
        },
      });
      setAiReview(result);
      toast.success("AI review complete");
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      toast.error("AI review failed: " + m.slice(0, 200));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-cyan-300">
          <Sparkles className="h-4 w-4" />
          <span className="font-medium">AI Reviewer</span>
          <span className="text-xs text-zinc-500">· {modeLabel}</span>
        </div>
        <Button
          size="sm"
          onClick={analyze}
          disabled={aiBusy}
          className="bg-cyan-500 text-black hover:bg-cyan-400"
        >
          {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span className="ml-1">{aiReview ? "Re-run" : "Analyze"}</span>
        </Button>
      </div>

      {!aiReview && !aiBusy && (
        <p className="text-xs text-zinc-500">
          {mode === "freelancer_precheck"
            ? "Get AI feedback on your proof before submitting — catch missing deliverables and improve approval chances."
            : mode === "dispute_review"
              ? "Review evidence from both sides and get a fair payout recommendation."
              : "Verify proof of work, detect fake or low-effort submissions, and get a recommendation."}
        </p>
      )}

      {aiReview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <ScoreCard label="Completion" score={aiReview.completion_score} />
            <ScoreCard label="Requirements" score={aiReview.requirement_match_score} />
            <ScoreCard label="AI confidence" score={aiReview.confidence_score} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RecommendationBadge rec={aiReview.recommendation} />
            <RiskBadge level={aiReview.risk_level} />
            <TimelineBadge timeline={aiReview.timeline} />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              Submission summary
            </div>
            <p className="text-sm text-zinc-200">{aiReview.submission_summary}</p>
          </div>

          {aiReview.verified_deliverables.length > 0 && (
            <BulletList
              title="Verified deliverables"
              items={aiReview.verified_deliverables}
              tone="ok"
            />
          )}
          {aiReview.missing_requirements.length > 0 && (
            <BulletList
              title="AI-detected missing requirements"
              items={aiReview.missing_requirements}
              tone="warn"
            />
          )}
          {aiReview.missing_deliverables.length > 0 && (
            <BulletList
              title="Missing deliverables"
              items={aiReview.missing_deliverables}
              tone="warn"
            />
          )}
          {aiReview.fraud_flags.length > 0 && (
            <BulletList title="Fraud / spam signals" items={aiReview.fraud_flags} tone="danger" />
          )}
          {aiReview.risk_flags.length > 0 && (
            <BulletList title="Risk flags" items={aiReview.risk_flags} tone="danger" />
          )}
          {aiReview.revision_suggestions.length > 0 && (
            <BulletList
              title="Revision suggestions (fix before dispute)"
              items={aiReview.revision_suggestions}
              tone="info"
            />
          )}
          {mode === "freelancer_precheck" && aiReview.freelancer_suggestions.length > 0 && (
            <BulletList
              title="Suggestions to improve approval"
              items={aiReview.freelancer_suggestions}
              tone="info"
            />
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              Suggested payout split
            </div>
            <div className="flex gap-2 text-xs">
              <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 px-2 py-1">
                Freelancer {(aiReview.freelancer_share_bps / 100).toFixed(1)}%
              </span>
              <span className="rounded-full bg-white/5 border border-white/10 text-zinc-300 px-2 py-1">
                Client {(aiReview.client_share_bps / 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Reasoning</div>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">
              {aiReview.reasoning_summary}
            </p>
          </div>

          {/* Signed on-chain actions based on AI recommendation */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            {canApprove && aiReview.recommendation === "approve_payment" && (
              <Button
                size="sm"
                onClick={onApprove}
                className="bg-emerald-500 text-black hover:bg-emerald-400"
              >
                <Check className="h-4 w-4 mr-1" /> Sign & approve payment
              </Button>
            )}
            {(isClient || isFreelancer) &&
              aiReview.recommendation === "request_revisions" &&
              (job.status === "submitted" || job.status === "in_progress") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onSendMessage(
                      `AI Reviewer requests revisions:\n\nMissing: ${aiReview.missing_deliverables.join(", ") || "n/a"}\n\n${aiReview.reasoning_summary}`,
                    )
                  }
                  className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                >
                  <Send className="h-4 w-4 mr-1" /> Sign & send revision request
                </Button>
              )}
            {canDispute &&
              (aiReview.recommendation === "partial_payment" ||
                aiReview.recommendation === "open_dispute") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onOpenDispute}
                  className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                >
                  <Gavel className="h-4 w-4 mr-1" /> Sign & open dispute
                </Button>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const tone =
    score >= 80
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/5"
      : score >= 50
        ? "text-amber-300 border-amber-500/30 bg-amber-500/5"
        : "text-red-300 border-red-500/30 bg-red-500/5";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-xl font-mono">{score}/100</div>
    </div>
  );
}

function RecommendationBadge({ rec }: { rec: AiReviewResult["recommendation"] }) {
  const map: Record<AiReviewResult["recommendation"], { label: string; cls: string }> = {
    approve_payment: {
      label: "Approve payment",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    },
    request_revisions: {
      label: "Request revisions",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    },
    partial_payment: {
      label: "Partial payment",
      cls: "bg-orange-500/15 text-orange-300 border-orange-500/40",
    },
    open_dispute: {
      label: "Open dispute",
      cls: "bg-red-500/15 text-red-300 border-red-500/40",
    },
  };
  const m = map[rec] ?? map.request_revisions;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
        AI recommendation
      </div>
      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm ${m.cls}`}>
        {m.label}
      </span>
    </div>
  );
}

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const map = {
    low: { label: "Risk: Low", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
    medium: { label: "Risk: Medium", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
    high: { label: "Risk: High", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  } as const;
  const m = map[level] ?? map.medium;
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${m.cls}`}>
      {m.label}
    </span>
  );
}

function TimelineBadge({ timeline }: { timeline: AiReviewResult["timeline"] }) {
  const cls =
    timeline.submitted_before_deadline === true
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : timeline.submitted_before_deadline === false
        ? "bg-red-500/15 text-red-300 border-red-500/40"
        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/40";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${cls}`}
      title={`Deadline: ${timeline.deadline || "n/a"} · Submitted: ${timeline.submitted_at || "n/a"}`}
    >
      ⏱ {timeline.note || "Timeline unknown"}
    </span>
  );
}

function BulletList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ok" | "warn" | "danger" | "info";
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-400"
      : tone === "warn"
        ? "bg-amber-400"
        : tone === "danger"
          ? "bg-red-400"
          : "bg-cyan-400";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{title}</div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-zinc-200 flex gap-2">
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
            <span className="whitespace-pre-wrap">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
