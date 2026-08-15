import { createServerFn } from "@tanstack/react-start";

export type AiReviewResult = {
  submission_summary: string;
  verified_deliverables: string[];
  missing_deliverables: string[];
  missing_requirements: string[];
  revision_suggestions: string[];
  completion_score: number;
  requirement_match_score: number;
  confidence_score: number;
  risk_level: "low" | "medium" | "high";
  risk_flags: string[];
  fraud_flags: string[];
  timeline: {
    submitted_before_deadline: boolean | null;
    deadline: string;
    submitted_at: string;
    note: string;
  };
  recommendation:
    | "approve_payment"
    | "request_revisions"
    | "partial_payment"
    | "open_dispute";
  freelancer_share_bps: number;
  client_share_bps: number;
  reasoning_summary: string;
  freelancer_suggestions: string[];
};

export type AiReviewInput = {
  mode: "freelancer_precheck" | "client_review" | "dispute_review";
  title: string;
  description: string;
  deliverables: string;
  deadline: string;
  budget: string;
  status: string;
  proof: string;
  submitted_at: string;
  messages: Array<{ from: string; body: string }>;
};

const SYSTEM = `You are an impartial AI reviewer for a freelance escrow platform on GenLayer.
You analyze freelance job submissions against original requirements. You examine:
- GitHub repos (structure, commits, code quality signals from URLs)
- Figma links (design deliverables)
- Deployed URLs (live sites / apps)
- Loom videos (walkthroughs)
- Screenshots and attached notes
- Chat context and deadlines

You produce a structured verdict useful for BOTH parties. Be fair, specific, and cite concrete evidence from the submitted proof. Do NOT invent facts. If a link is missing or unverifiable, flag it. Respond with STRICT JSON matching the schema, no prose, no markdown fences.`;

function buildPrompt(input: AiReviewInput) {
  const rolePrompt =
    input.mode === "freelancer_precheck"
      ? "The FREELANCER is asking for a pre-submission review. Highlight missing deliverables and concrete fixes to improve approval chances. Be encouraging but strict."
      : input.mode === "dispute_review"
        ? "A DISPUTE is open. Review evidence from both sides fairly and recommend the fairest payout split."
        : "The CLIENT is reviewing submitted work. Detect fake, incomplete, or low-effort work. Verify deliverables against requirements.";

  return `${rolePrompt}

# Job
Title: ${input.title}
Status: ${input.status}
Deadline: ${input.deadline || "unspecified"}
Budget (wei): ${input.budget}

# Original description
${input.description || "(none)"}

# Required deliverables
${input.deliverables || "(none)"}

# Submitted proof of work
${input.proof || "(nothing submitted yet)"}
Submitted at: ${input.submitted_at || "n/a"}

# Chat history between client and freelancer
${
  input.messages.length === 0
    ? "(no messages)"
    : input.messages.map((m) => `- ${m.from.slice(0, 10)}: ${m.body}`).join("\n")
}

Respond ONLY with JSON exactly matching this shape:
{
  "submission_summary": string,
  "verified_deliverables": string[],
  "missing_deliverables": string[],
  "missing_requirements": string[],
  "revision_suggestions": string[],
  "completion_score": integer 0-100,
  "requirement_match_score": integer 0-100,
  "confidence_score": integer 0-100,
  "risk_level": "low" | "medium" | "high",
  "risk_flags": string[],
  "fraud_flags": string[],
  "timeline": {
    "submitted_before_deadline": boolean | null,
    "deadline": string,
    "submitted_at": string,
    "note": string
  },
  "recommendation": "approve_payment" | "request_revisions" | "partial_payment" | "open_dispute",
  "freelancer_share_bps": integer 0-10000,
  "client_share_bps": integer 0-10000,
  "reasoning_summary": string,
  "freelancer_suggestions": string[]
}

Rules:
- freelancer_share_bps + client_share_bps MUST equal 10000
- approve_payment => freelancer_share_bps >= 9000
- request_revisions => freelancer_share_bps between 5000-8999
- partial_payment => freelancer_share_bps between 3000-7000
- open_dispute => any split you find fair based on evidence
- confidence_score: how confident YOU are in this assessment given the evidence (links accessible? proof detailed?). Lower it when links are unverifiable or proof is thin.
- risk_level: overall risk of approving as-is. "high" if fraud_flags non-empty or many missing requirements.
- missing_requirements: line items from the ORIGINAL job description/deliverables not addressed by the proof.
- revision_suggestions: 2-6 concrete, prioritized fixes the freelancer can do BEFORE a dispute is needed. Always populate when recommendation != approve_payment.
- fraud_flags: concrete signs of fake/cloned/plagiarized work — e.g. GitHub repo with 1 commit dumping generated code, forked-without-attribution repos, dead deployed URLs, stolen Figma community files, AI-boilerplate with no customization, mismatched author. Empty [] if none.
- timeline.submitted_before_deadline: true if submitted_at <= deadline, false if late, null if either is missing/unparseable. Put a short human note like "Submitted 2 days before deadline" or "Late by 3h".
- Keep reasoning_summary under 800 chars.
- freelancer_suggestions: 3-6 concrete actionable items if mode is freelancer_precheck, else can be empty [].`;
}

export const runAiReview = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as AiReviewInput)
  .handler(async ({ data }): Promise<AiReviewResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(data) },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI rate limit — try again in a moment");
      if (res.status === 402) throw new Error("AI credits exhausted for this workspace");
      throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as AiReviewResult;

    // clamp / defaults
    parsed.completion_score = Math.max(0, Math.min(100, Number(parsed.completion_score) || 0));
    parsed.requirement_match_score = Math.max(
      0,
      Math.min(100, Number(parsed.requirement_match_score) || 0),
    );
    let f = Math.max(0, Math.min(10000, Number(parsed.freelancer_share_bps) || 0));
    let c = Math.max(0, Math.min(10000, Number(parsed.client_share_bps) || 0));
    if (f + c !== 10000) {
      if (f + c === 0) {
        f = 10000;
        c = 0;
      } else {
        const total = f + c;
        f = Math.round((f / total) * 10000);
        c = 10000 - f;
      }
    }
    parsed.freelancer_share_bps = f;
    parsed.client_share_bps = c;
    parsed.verified_deliverables ||= [];
    parsed.missing_deliverables ||= [];
    parsed.missing_requirements ||= [];
    parsed.revision_suggestions ||= [];
    parsed.risk_flags ||= [];
    parsed.fraud_flags ||= [];
    parsed.freelancer_suggestions ||= [];
    parsed.confidence_score = Math.max(
      0,
      Math.min(100, Number(parsed.confidence_score) || 0),
    );
    const rl = String(parsed.risk_level || "").toLowerCase();
    parsed.risk_level =
      rl === "high" || rl === "medium" || rl === "low"
        ? (rl as "low" | "medium" | "high")
        : parsed.fraud_flags.length > 0 || parsed.missing_requirements.length >= 3
          ? "high"
          : parsed.missing_requirements.length > 0
            ? "medium"
            : "low";

    // Deterministic timeline verification (don't trust LLM math)
    const deadlineTs = Date.parse(data.deadline);
    const submittedTs = Date.parse(data.submitted_at);
    const t = parsed.timeline || ({} as AiReviewResult["timeline"]);
    t.deadline = data.deadline || "";
    t.submitted_at = data.submitted_at || "";
    if (!Number.isFinite(deadlineTs) || !Number.isFinite(submittedTs)) {
      t.submitted_before_deadline = null;
      t.note ||= "Deadline or submission time not available.";
    } else {
      const onTime = submittedTs <= deadlineTs;
      t.submitted_before_deadline = onTime;
      const diffMs = Math.abs(submittedTs - deadlineTs);
      const hours = Math.round(diffMs / 3_600_000);
      const days = Math.round(diffMs / 86_400_000);
      const human = days >= 1 ? `${days}d` : `${hours}h`;
      t.note = onTime
        ? `Submitted ${human} before deadline`
        : `Late by ${human}`;
    }
    parsed.timeline = t;
    return parsed;
  });
