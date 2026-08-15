# GenLayer Freelance Escrow

An on-chain, AI-arbitrated freelance escrow dApp built on **GenLayer Studionet**. Clients lock funds in a smart contract, freelancers submit verifiable work (source repo + optional deployed URL), and disputes are resolved by **GenLayer validators that fetch real evidence from the web** and reach LLM consensus via the equivalence principle.

Live contract: `0xB1ca2B7eAda9d77C358037A422F8085731c0F669` (GenLayer Studionet, chain id `61999`).

---

## How it was built

- **Frontend**: TanStack Start v1 (React 19 + Vite 7), Tailwind v4, shadcn/ui, file-based routing under `src/routes/`.
- **Wallet**: MetaMask only — no burner or mock wallets. All writes are signed through `window.ethereum` and the app auto-adds/switches to the Studionet chain.
- **Chain client**: [`genlayer-js`](https://www.npmjs.com/package/genlayer-js) — reads via `readContract`, writes via `writeContract` routed through MetaMask.
- **Smart contract**: Python (`py-genlayer` intelligent-contract SDK). State is JSON-serialised on-chain for easy iteration. Disputes call `gl.nondet.web.get` inside `gl.eq_principle.prompt_comparative`, so **validators independently fetch the repo and deploy URL and judge the actual bytes**, not the freelancer's claims.
- **AI Reviewer (client-side assist)**: A `createServerFn` (`src/lib/ai-review.functions.ts`) that returns a structured JSON review (scores, risk level, timeline, missing requirements, revision suggestions, fraud flags) to help both parties before a formal on-chain dispute.

## Key features

### Escrow lifecycle
- Client creates a job → **budget is locked** in the contract (`create_job`, payable).
- Freelancer accepts (`accept_job`), works, submits with **mandatory public source repo** (`submit_work`).
- Client can `approve_and_release` for instant payout, `cancel_open_job` for a refund, or `open_dispute`.
- Anyone can `finalize_resolved` after the oracle resolves a dispute — payouts split per verdict.

### Verifiable submissions
- `submit_work` **rejects deploy-only links on-chain**. Only public repos on GitHub / GitLab / Bitbucket / Codeberg / SourceHut are accepted (validated both client-side and in the contract).
- Deployed URLs are optional context, never sufficient by themselves.

### Real-evidence dispute resolution
- `review_dispute` uses `gl.nondet.web.get` to fetch the repo page and the deployed URL live.
- Fetched bytes (truncated to 12k chars) are embedded into the prompt; validators must cite **concrete facts from the fetched pages** in an `ai_evidence` field.
- Equivalence principle enforces cross-validator consensus on verdict + payout split.
- Verdict shape: `verdict ∈ {full, partial, unsatisfactory}`, `completeness` 0-100, `quality` 0-100, `freelancer_share_bps + client_share_bps = 10000`.

### AI Reviewer (pre-dispute assistant)
Server function that returns:
- Submission summary, verified vs missing deliverables
- Completion score, requirement-match score, **AI confidence %**
- **Risk level badge** (low / medium / high) with fraud flags (cloned repos, empty commits, spam)
- **Timeline verification** (submitted before deadline, deadline diff)
- Revision suggestions before disputes happen
- Recommendation: approve / request revisions / partial / open dispute
- Fair split proposal (`freelancer_share_bps` / `client_share_bps`) when a dispute is likely

### UX
- MetaMask connect with chain auto-add/switch, account-change listeners
- Job board with status filters, chat thread per job (context fed to validators)
- Score cards, risk badges, timeline badges, ai_evidence citations
- Responsive; matches shadcn/ui design tokens

## Project layout

All application source lives under `src/` — nothing app-related sits at the repository
root except configuration. This is the exact tree the Vite config, the `@/*` TypeScript
path alias, and the TanStack Router plugin expect:

```
package.json
tsconfig.json                       # "@/*" -> "./src/*"
vite.config.ts                      # @lovable.dev/vite-tanstack-config (TanStack Start + Router plugin)
components.json                     # shadcn/ui aliases -> src/components/ui, src/lib
contracts/
  freelance_escrow.py               # GenLayer intelligent contract
src/
  styles.css                        # Tailwind v4 entry (@theme tokens)
  router.tsx                        # createRouter + QueryClient context
  routeTree.gen.ts                  # GENERATED route tree (committed, see below)
  server.ts, start.ts               # SSR entry + client function middleware
  routes/
    __root.tsx                      # App shell, head metadata, providers
    index.tsx                       # Main UI (jobs, chat, submissions, disputes)
  lib/
    genlayer.ts                     # MetaMask + genlayer-js client, reads/writes
    ai-review.functions.ts          # AI Reviewer server function
    utils.ts, error-*.ts            # helpers
  components/
    ui/                             # shadcn/ui primitives
  hooks/
    use-mobile.tsx
```

Paths are import-critical: `@/lib/genlayer` resolves to `src/lib/genlayer.ts`, and every
file under `src/routes/` is registered as a URL route by the router plugin. Moving a page
out of `src/routes/` makes it unreachable.

## Route tree (`src/routeTree.gen.ts`)

`src/routeTree.gen.ts` is generated by the TanStack Router Vite plugin from the files in
`src/routes/`, and it **is committed** so a fresh clone typechecks before the first dev
run. Never hand-edit it.

To regenerate it (after adding/renaming/removing a route file) just start the dev server
or run a build — the plugin rewrites the file automatically:

```bash
bun run dev     # regenerates on startup and on every route file change
# or
bun run build   # regenerates, then builds
```

If it ever goes stale or gets deleted, delete it and re-run `bun run dev`; commit the
regenerated file with your route change.

## Running locally

```bash
bun install     # installs pinned deps from bun.lock
bun run dev     # http://localhost:8080
```

Open the app, connect MetaMask, approve the switch to GenLayer Studionet, and you're in. To point the frontend at a redeployed contract, update `CONTRACT_ADDRESS` in `src/lib/genlayer.ts`.


## Redeploying the contract

Deploy `contracts/freelance_escrow.py` via the GenLayer Studio, copy the new address into `src/lib/genlayer.ts`, and reload.
