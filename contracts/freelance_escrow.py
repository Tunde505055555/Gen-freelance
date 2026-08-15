# v0.4.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

import json


# ---------------------------------------------------------------------------
# AI Reputation Escrow for Freelancers
# ---------------------------------------------------------------------------
# Clients post jobs and lock funds. Freelancers accept and submit proof.
#
# Submissions are PINNED TO AN IMMUTABLE COMMIT: they must include a public
# source repository URL (GitHub / GitLab / Bitbucket / Codeberg / SourceHut)
# AND a full 40-hex commit SHA. Validators do not read the mutable repo
# landing page: they fetch host API endpoints for that exact commit
# (commit metadata + recursive file tree + README blob at the commit), so the
# evidence cannot be changed after submission.
#
# Disputes cannot get stuck:
#   * review_dispute is PERMISSIONLESS (anyone may trigger validator review).
#   * claim_after_review_timeout  -> freelancer is paid if the client never
#     approves nor disputes within REVIEW_WINDOW_DAYS of submission.
#   * refund_after_delivery_timeout -> client is refunded if no submission
#     arrives by deadline + DELIVERY_GRACE_DAYS.
#   * split_after_dispute_timeout -> permissionless 50/50 recovery if a
#     dispute is never resolved within DISPUTE_TIMEOUT_DAYS.
# All timeouts use an on-chain, consensus-agreed UTC date fetched by
# validators (strict equality on day granularity) — never caller-supplied time.
# ---------------------------------------------------------------------------


@gl.evm.contract_interface
class _Payee:
    class View:
        pass

    class Write:
        pass


# Accepted source-hosting hosts. Deploy-only links (e.g. vercel.app,
# netlify.app, custom domains) do not qualify — source must be inspectable.
_SOURCE_HOSTS = (
    "github.com/",
    "gitlab.com/",
    "bitbucket.org/",
    "codeberg.org/",
    "git.sr.ht/",
)

# Cap fetched-content size fed to the LLM to keep prompts bounded.
_MAX_FETCH_CHARS = 9000

# Timeout windows (days).
_REVIEW_WINDOW_DAYS = 7
_DELIVERY_GRACE_DAYS = 7
_DISPUTE_TIMEOUT_DAYS = 14

_HEX = "0123456789abcdef"

_TIME_URL = "https://worldtimeapi.org/api/timezone/Etc/UTC"


# ---------------------------------------------------------------------------
# URL / commit validation
# ---------------------------------------------------------------------------
def _split_repo(url: str) -> tuple:
    """Return (host, owner, repo) for a supported source URL, else ("", "", "")."""
    if not url:
        return ("", "", "")
    lo = url.strip().lower()
    if not (lo.startswith("https://") or lo.startswith("http://")):
        return ("", "", "")
    for h in _SOURCE_HOSTS:
        if h in lo:
            after = lo.split(h, 1)[1]
            parts = [p for p in after.split("/") if p]
            if len(parts) >= 2:
                repo = parts[1]
                if repo.endswith(".git"):
                    repo = repo[:-4]
                return (h[:-1], parts[0], repo)
    return ("", "", "")


def _is_valid_source_repo(url: str) -> bool:
    host, owner, repo = _split_repo(url)
    return host != "" and owner != "" and repo != ""


def _is_valid_commit(sha: str) -> bool:
    if not sha:
        return False
    s = sha.strip().lower()
    if len(s) != 40:
        return False
    for c in s:
        if c not in _HEX:
            return False
    return True


def _pinned_sources(url: str, sha: str) -> list:
    """Immutable, commit-pinned evidence endpoints for a repo host."""
    host, owner, repo = _split_repo(url)
    base = url.strip().rstrip("/")
    out = []
    if host == "github.com":
        out = [
            ("commit metadata", f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"),
            (
                "file tree",
                f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1",
            ),
            ("README at commit", f"https://raw.githubusercontent.com/{owner}/{repo}/{sha}/README.md"),
        ]
    elif host == "gitlab.com":
        pid = f"{owner}%2F{repo}"
        out = [
            (
                "commit metadata",
                f"https://gitlab.com/api/v4/projects/{pid}/repository/commits/{sha}",
            ),
            (
                "file tree",
                f"https://gitlab.com/api/v4/projects/{pid}/repository/tree?ref={sha}&recursive=true&per_page=100",
            ),
            (
                "README at commit",
                f"https://gitlab.com/{owner}/{repo}/-/raw/{sha}/README.md",
            ),
        ]
    elif host == "bitbucket.org":
        out = [
            (
                "commit metadata",
                f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}/commit/{sha}",
            ),
            (
                "file tree",
                f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}/src/{sha}/",
            ),
            (
                "README at commit",
                f"https://bitbucket.org/{owner}/{repo}/raw/{sha}/README.md",
            ),
        ]
    elif host == "codeberg.org":
        out = [
            (
                "commit metadata",
                f"https://codeberg.org/api/v1/repos/{owner}/{repo}/git/commits/{sha}",
            ),
            (
                "file tree",
                f"https://codeberg.org/api/v1/repos/{owner}/{repo}/git/trees/{sha}?recursive=true",
            ),
            (
                "README at commit",
                f"https://codeberg.org/{owner}/{repo}/raw/commit/{sha}/README.md",
            ),
        ]
    else:
        out = [
            ("commit page", f"{base}/commit/{sha}"),
            ("tree at commit", f"{base}/tree/{sha}"),
        ]
    return out


def _safe_fetch(url: str, limit: int) -> str:
    if not url:
        return "(no url)"
    try:
        resp = gl.nondet.web.get(url)
        body = resp.body.decode("utf-8", errors="replace")
        if len(body) > limit:
            body = body[:limit] + "\n…[truncated]"
        return body
    except Exception as e:
        return f"(fetch failed: {str(e)[:200]})"


# ---------------------------------------------------------------------------
# Date helpers (UTC, day granularity)
# ---------------------------------------------------------------------------
def _parse_date(text: str) -> int:
    """Parse a leading YYYY-MM-DD out of text -> day number, or -1."""
    if not text:
        return -1
    s = text.strip()
    if len(s) < 10:
        return -1
    head = s[:10]
    if head[4] != "-" or head[7] != "-":
        return -1
    y = head[0:4]
    m = head[5:7]
    d = head[8:10]
    if not (y.isdigit() and m.isdigit() and d.isdigit()):
        return -1
    return _days_from_civil(int(y), int(m), int(d))


def _days_from_civil(y: int, m: int, d: int) -> int:
    """Howard Hinnant's civil-to-days algorithm (no datetime dependency)."""
    yy = y - 1 if m <= 2 else y
    era = (yy if yy >= 0 else yy - 399) // 400
    yoe = yy - era * 400
    mp = (m + 9) % 12
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _today_utc() -> str:
    """Consensus UTC date (YYYY-MM-DD) agreed by all validators."""

    def fetch_date() -> str:
        body = _safe_fetch(_TIME_URL, 2000)
        try:
            return str(json.loads(body)["datetime"])[:10]
        except Exception:
            return ""

    value = gl.eq_principle.strict_eq(fetch_date)
    if not value or len(value) != 10:
        raise gl.vm.UserError("could not establish a consensus UTC date")
    return value


class FreelanceEscrow(gl.Contract):
    owner: Address
    next_id: u256
    jobs_json: str
    messages_json: str

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.next_id = u256(0)
        self.jobs_json = "[]"
        self.messages_json = "{}"

    # -----------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------
    def _load_jobs(self) -> list:
        return json.loads(self.jobs_json)

    def _save_jobs(self, jobs: list) -> None:
        self.jobs_json = json.dumps(jobs)

    def _load_messages(self) -> dict:
        return json.loads(self.messages_json)

    def _save_messages(self, msgs: dict) -> None:
        self.messages_json = json.dumps(msgs)

    def _find_job(self, jobs: list, job_id: str) -> dict:
        for j in jobs:
            if j["id"] == job_id:
                return j
        raise gl.vm.UserError("job not found: " + job_id)

    def _pay(self, to: str, amount: int) -> None:
        if amount > 0 and to != "":
            _Payee(Address(to)).emit_transfer(value=u256(amount))

    # -----------------------------------------------------------------
    # Client actions
    # -----------------------------------------------------------------
    @gl.public.write.payable
    def create_job(
        self,
        title: str,
        description: str,
        deliverables: str,
        deadline: str,
    ) -> str:
        v = gl.message.value
        if v == u256(0):
            raise gl.vm.UserError("must lock a non-zero budget in escrow")

        jobs = self._load_jobs()
        jid = str(int(self.next_id))
        self.next_id = self.next_id + u256(1)

        jobs.append(
            {
                "id": jid,
                "client": str(gl.message.sender_address.as_hex),
                "freelancer": "",
                "title": title,
                "description": description,
                "deliverables": deliverables,
                "deadline": deadline,
                "budget": str(int(v)),
                "status": "open",
                "source_repo": "",
                "commit_sha": "",
                "deployed_url": "",
                "proof": "",
                "submitted_at": "",
                "submitted_date": "",
                "dispute_opened_date": "",
                "ai_verdict": "",
                "ai_rationale": "",
                "ai_evidence": "",
                "completeness": "0",
                "quality": "0",
                "client_share_bps": "0",
                "freelancer_share_bps": "0",
                "resolved": "false",
                "closed_reason": "",
            }
        )
        self._save_jobs(jobs)

        msgs = self._load_messages()
        msgs[jid] = []
        self._save_messages(msgs)
        return jid

    @gl.public.write
    def cancel_open_job(self, job_id: str) -> None:
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if str(gl.message.sender_address.as_hex) != job["client"]:
            raise gl.vm.UserError("only the client can cancel")
        if job["status"] != "open":
            raise gl.vm.UserError("job is not open")

        refund = int(job["budget"])
        job["status"] = "cancelled"
        job["budget"] = "0"
        job["closed_reason"] = "cancelled by client while open"
        self._save_jobs(jobs)
        self._pay(job["client"], refund)

    @gl.public.write
    def approve_and_release(self, job_id: str) -> None:
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if str(gl.message.sender_address.as_hex) != job["client"]:
            raise gl.vm.UserError("only the client can approve")
        if job["status"] != "submitted":
            raise gl.vm.UserError("job is not awaiting approval")

        payout = int(job["budget"])
        job["status"] = "completed"
        job["resolved"] = "true"
        job["client_share_bps"] = "0"
        job["freelancer_share_bps"] = "10000"
        job["budget"] = "0"
        job["closed_reason"] = "approved by client"
        self._save_jobs(jobs)
        self._pay(job["freelancer"], payout)

    # -----------------------------------------------------------------
    # Freelancer actions
    # -----------------------------------------------------------------
    @gl.public.write
    def accept_job(self, job_id: str) -> None:
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if job["status"] != "open":
            raise gl.vm.UserError("job is not open")
        job["freelancer"] = str(gl.message.sender_address.as_hex)
        job["status"] = "in_progress"
        self._save_jobs(jobs)

    @gl.public.write
    def submit_work(
        self,
        job_id: str,
        source_repo: str,
        commit_sha: str,
        deployed_url: str,
        proof: str,
        submitted_at: str,
    ) -> None:
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if str(gl.message.sender_address.as_hex) != job["freelancer"]:
            raise gl.vm.UserError("only the assigned freelancer can submit")
        if job["status"] != "in_progress" and job["status"] != "disputed":
            raise gl.vm.UserError("job is not in a submittable state")
        if not _is_valid_source_repo(source_repo):
            raise gl.vm.UserError(
                "source_repo must be a public GitHub/GitLab/Bitbucket/"
                "Codeberg/SourceHut repository URL — deploy-only links "
                "are not accepted"
            )
        if not _is_valid_commit(commit_sha):
            raise gl.vm.UserError(
                "commit_sha must be a full 40-character hex commit hash so the "
                "submission is pinned to immutable source"
            )

        job["source_repo"] = source_repo.strip()
        job["commit_sha"] = commit_sha.strip().lower()
        job["deployed_url"] = (deployed_url or "").strip()
        job["proof"] = proof
        job["submitted_at"] = submitted_at
        job["submitted_date"] = _today_utc()
        job["status"] = "submitted"
        self._save_jobs(jobs)

    # -----------------------------------------------------------------
    # Chat (context used by the AI oracle during disputes)
    # -----------------------------------------------------------------
    @gl.public.write
    def post_message(self, job_id: str, body: str) -> None:
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        sender = str(gl.message.sender_address.as_hex)
        if sender != job["client"] and sender != job["freelancer"]:
            raise gl.vm.UserError("only client or freelancer can post")
        msgs = self._load_messages()
        thread = msgs.get(job_id, [])
        thread.append({"from": sender, "body": body})
        msgs[job_id] = thread
        self._save_messages(msgs)

    # -----------------------------------------------------------------
    # Disputes
    # -----------------------------------------------------------------
    @gl.public.write
    def open_dispute(self, job_id: str) -> None:
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        sender = str(gl.message.sender_address.as_hex)
        if sender != job["client"] and sender != job["freelancer"]:
            raise gl.vm.UserError("only client or freelancer can dispute")
        if job["status"] != "submitted" and job["status"] != "in_progress":
            raise gl.vm.UserError("job is not disputable")
        if job["status"] == "submitted":
            if not _is_valid_source_repo(job.get("source_repo", "")):
                raise gl.vm.UserError(
                    "cannot dispute a submission without a valid source repo"
                )
            if not _is_valid_commit(job.get("commit_sha", "")):
                raise gl.vm.UserError(
                    "cannot dispute a submission that is not pinned to a commit"
                )
        job["status"] = "disputed"
        job["dispute_opened_date"] = _today_utc()
        self._save_jobs(jobs)

    @gl.public.write
    def review_dispute(self, job_id: str) -> None:
        """PERMISSIONLESS: anyone may trigger validator review of a dispute."""
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if job["status"] != "disputed":
            raise gl.vm.UserError("job is not disputed")
        if not _is_valid_source_repo(job.get("source_repo", "")):
            raise gl.vm.UserError(
                "dispute requires a valid source_repo on the submission"
            )
        if not _is_valid_commit(job.get("commit_sha", "")):
            raise gl.vm.UserError(
                "dispute requires a submission pinned to a 40-hex commit"
            )

        msgs = self._load_messages()
        thread = msgs.get(job_id, [])

        source_repo = job["source_repo"]
        commit_sha = job["commit_sha"]
        deployed_url = job.get("deployed_url", "")
        title = job["title"]
        description = job["description"]
        deliverables = job["deliverables"]
        deadline = job["deadline"]
        budget = job["budget"]
        proof = job["proof"]
        submitted_at = job["submitted_at"]
        submitted_date = job.get("submitted_date", "")
        thread_json = json.dumps(thread)
        pinned = _pinned_sources(source_repo, commit_sha)

        # ------------------------------------------------------------
        # Validators independently FETCH commit-pinned (immutable) evidence
        # and feed it — not user claims — into the LLM. The equivalence
        # principle forces consensus across validators.
        # ------------------------------------------------------------
        def run_llm() -> str:
            blocks = []
            for label, url in pinned:
                content = _safe_fetch(url, _MAX_FETCH_CHARS // max(len(pinned), 1))
                blocks.append(
                    f"--- BEGIN {label.upper()} ({url}) ---\n{content}\n--- END {label.upper()} ---"
                )
            repo_evidence = "\n\n".join(blocks)
            deploy_content = (
                _safe_fetch(deployed_url, 3000) if deployed_url else "(none provided)"
            )

            prompt = f"""
You are an impartial reviewer for a freelance escrow dispute. You are given
LIVE fetched evidence pinned to an IMMUTABLE COMMIT of the freelancer's
repository (commit metadata, the recursive file tree at that commit, and the
README blob at that commit), plus the deployed URL if any. Judge the ACTUAL
evidence below — do NOT trust any claim in the proof text or chat that the
fetched evidence does not support. If the commit does not exist, the tree is
empty, or the files clearly do not implement the deliverables, treat the
submission as unsatisfactory regardless of what the freelancer says.

# Job
Title: {title}
Description: {description}
Deliverables required: {deliverables}
Deadline: {deadline}
Submission date recorded on-chain (UTC): {submitted_date}
Budget (locked in escrow, integer wei): {budget}

# Pinned source evidence (mandatory, immutable at commit {commit_sha})
Repository: {source_repo}
{repo_evidence}

# Deployed URL (optional, verified fetched)
URL: {deployed_url or "(none)"}
--- BEGIN FETCHED DEPLOY PAGE ---
{deploy_content}
--- END FETCHED DEPLOY PAGE ---

# Freelancer proof notes (unverified, for context only)
{proof}
Client-reported submission timestamp: {submitted_at}

# Chat history between client and freelancer (unverified claims)
{thread_json}

# Task
Base your verdict on the fetched evidence above. Cross-check the deliverables
against the file tree and README at the pinned commit, and against commit
metadata (author, date, changed files). Penalize mismatches: a deploy page
that exists while the pinned tree is empty or trivial, a commit that only
adds boilerplate or a fork with no work, files unrelated to the deliverables,
or a commit dated after the deadline.

Respond with STRICT JSON, no prose, matching exactly:
{{
"verdict": "full" | "partial" | "unsatisfactory",
"completeness": 0-100,
"quality": 0-100,
"freelancer_share_bps": 0-10000,
"client_share_bps": 0-10000,
"evidence": "<= 400 chars citing concrete facts from the fetched evidence",
"rationale": "<= 600 chars explaining the decision"
}}

Constraints:
- freelancer_share_bps + client_share_bps MUST equal 10000.
- "full"           => freelancer_share_bps >= 9000
- "partial"        => 3000 <= freelancer_share_bps <= 8999
- "unsatisfactory" => freelancer_share_bps <= 2999
- If the commit metadata or file tree fetch failed or is empty/missing, the
  verdict MUST be "unsatisfactory".

Respond only with the JSON above, nothing else. The response must be
perfectly parseable as JSON.
"""
            return (
                gl.nondet.exec_prompt(prompt)
                .replace("```json", "")
                .replace("```", "")
            )

        result = gl.eq_principle.prompt_comparative(
            run_llm,
            "The verdict matches and freelancer_share_bps values are within 1000 of each other",
        )

        parsed = json.loads(result)
        f_bps = int(parsed["freelancer_share_bps"])
        c_bps = int(parsed["client_share_bps"])
        if f_bps + c_bps != 10000:
            raise gl.vm.UserError("invalid payout split returned by oracle")

        job["ai_verdict"] = str(parsed["verdict"])
        job["ai_rationale"] = str(parsed.get("rationale", ""))
        job["ai_evidence"] = str(parsed.get("evidence", ""))
        job["completeness"] = str(int(parsed.get("completeness", 0)))
        job["quality"] = str(int(parsed.get("quality", 0)))
        job["freelancer_share_bps"] = str(f_bps)
        job["client_share_bps"] = str(c_bps)
        job["status"] = "resolved"
        job["resolved"] = "true"
        self._save_jobs(jobs)

    @gl.public.write
    def finalize_resolved(self, job_id: str) -> None:
        """PERMISSIONLESS: anyone may push a resolved dispute to payout."""
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if job["status"] != "resolved":
            raise gl.vm.UserError("job is not resolved")

        budget = int(job["budget"])
        f_bps = int(job["freelancer_share_bps"])
        c_bps = int(job["client_share_bps"])
        f_amount = (budget * f_bps) // 10000
        c_amount = budget - f_amount

        job["status"] = "finalized"
        job["budget"] = "0"
        job["closed_reason"] = "validator verdict finalized"
        self._save_jobs(jobs)

        self._pay(job["freelancer"], f_amount)
        self._pay(job["client"], c_amount)

    # -----------------------------------------------------------------
    # Permissionless timeout / recovery paths
    # -----------------------------------------------------------------
    @gl.public.write
    def claim_after_review_timeout(self, job_id: str) -> None:
        """Client never reviewed: release full escrow to the freelancer."""
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if job["status"] != "submitted":
            raise gl.vm.UserError("job is not awaiting client review")

        start = _parse_date(job.get("submitted_date", ""))
        if start < 0:
            raise gl.vm.UserError("submission has no on-chain date")
        today = _parse_date(_today_utc())
        if today - start < _REVIEW_WINDOW_DAYS:
            raise gl.vm.UserError(
                "review window has not elapsed yet ("
                + str(_REVIEW_WINDOW_DAYS)
                + " days)"
            )

        payout = int(job["budget"])
        job["status"] = "completed"
        job["resolved"] = "true"
        job["client_share_bps"] = "0"
        job["freelancer_share_bps"] = "10000"
        job["budget"] = "0"
        job["closed_reason"] = "auto-released: client review timeout"
        self._save_jobs(jobs)
        self._pay(job["freelancer"], payout)

    @gl.public.write
    def refund_after_delivery_timeout(self, job_id: str) -> None:
        """No submission by deadline + grace: refund the client."""
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if job["status"] != "in_progress":
            raise gl.vm.UserError("job is not awaiting delivery")

        due = _parse_date(job.get("deadline", ""))
        if due < 0:
            raise gl.vm.UserError(
                "job deadline is not an ISO date (YYYY-MM-DD); cannot time out"
            )
        today = _parse_date(_today_utc())
        if today - due < _DELIVERY_GRACE_DAYS:
            raise gl.vm.UserError(
                "delivery grace period has not elapsed yet ("
                + str(_DELIVERY_GRACE_DAYS)
                + " days after deadline)"
            )

        refund = int(job["budget"])
        job["status"] = "cancelled"
        job["resolved"] = "true"
        job["client_share_bps"] = "10000"
        job["freelancer_share_bps"] = "0"
        job["budget"] = "0"
        job["closed_reason"] = "auto-refunded: delivery timeout"
        self._save_jobs(jobs)
        self._pay(job["client"], refund)

    @gl.public.write
    def split_after_dispute_timeout(self, job_id: str) -> None:
        """Dispute never resolved: permissionless 50/50 escrow recovery."""
        jobs = self._load_jobs()
        job = self._find_job(jobs, job_id)
        if job["status"] != "disputed":
            raise gl.vm.UserError("job is not disputed")

        opened = _parse_date(job.get("dispute_opened_date", ""))
        if opened < 0:
            raise gl.vm.UserError("dispute has no on-chain open date")
        today = _parse_date(_today_utc())
        if today - opened < _DISPUTE_TIMEOUT_DAYS:
            raise gl.vm.UserError(
                "dispute timeout has not elapsed yet ("
                + str(_DISPUTE_TIMEOUT_DAYS)
                + " days) — anyone can call review_dispute meanwhile"
            )

        budget = int(job["budget"])
        f_amount = budget // 2
        c_amount = budget - f_amount

        job["status"] = "finalized"
        job["resolved"] = "true"
        job["ai_verdict"] = "timeout_split"
        job["ai_rationale"] = (
            "Dispute was never resolved within the timeout window; escrow "
            "recovered with an even split."
        )
        job["freelancer_share_bps"] = "5000"
        job["client_share_bps"] = "5000"
        job["budget"] = "0"
        job["closed_reason"] = "auto-split: dispute resolution timeout"
        self._save_jobs(jobs)

        self._pay(job["freelancer"], f_amount)
        self._pay(job["client"], c_amount)

    # -----------------------------------------------------------------
    # Views
    # -----------------------------------------------------------------
    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner.as_hex)

    @gl.public.view
    def get_balance(self) -> u256:
        return self.balance

    @gl.public.view
    def get_jobs(self) -> str:
        return self.jobs_json

    @gl.public.view
    def get_job(self, job_id: str) -> str:
        jobs = self._load_jobs()
        return json.dumps(self._find_job(jobs, job_id))

    @gl.public.view
    def get_messages(self, job_id: str) -> str:
        msgs = self._load_messages()
        return json.dumps(msgs.get(job_id, []))

    @gl.public.view
    def get_timeouts(self) -> str:
        return json.dumps(
            {
                "review_window_days": _REVIEW_WINDOW_DAYS,
                "delivery_grace_days": _DELIVERY_GRACE_DAYS,
                "dispute_timeout_days": _DISPUTE_TIMEOUT_DAYS,
            }
        )
