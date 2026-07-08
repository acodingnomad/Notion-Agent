import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// Who is who in the conversation. Lowercased email addresses.
export const AGENCY_SENDERS = [
  "teresa@thedriveagency.co",
  "patrick@thedriveagency.co",
];

export const CREATOR_SENDERS = [
  "codingnomadpr@gmail.com",
  "khristinasar@gmail.com",
  "khrissheer@gmail.com",
];

const MILESTONES = [
  "script_requested",
  "script_submitted",
  "script_approved",
  "draft_submitted",
  "draft_approved",
  "live_date_scheduled",
  "posted_live",
];

// Pull the bare email address out of a "Name <email>" header.
export function parseAddress(fromHeader = "") {
  const match = fromHeader.match(/<([^>]+)>/);
  const addr = (match ? match[1] : fromHeader).trim().toLowerCase();
  return addr;
}

export function senderRole(fromHeader) {
  const addr = parseAddress(fromHeader);
  if (AGENCY_SENDERS.includes(addr)) return "AGENCY";
  if (CREATOR_SENDERS.includes(addr)) return "CREATOR";
  return "OTHER";
}

const SYSTEM_PROMPT = `You track the progress of ONE influencer brand deal between the creator (Khristina / "CODINGNOMAD") and her talent agency ("The Drive Agency"), by reading an email thread.

Each message is prefixed with its sender ROLE (AGENCY, CREATOR, or OTHER) and a marker:
- [NEW] = a recent message. Detect milestones ONLY from [NEW] messages.
- [context] = an older message, provided ONLY so you understand references (e.g. which video number). NEVER report a milestone that is evidenced only by [context] messages.

Your job: report which milestones just happened in the [NEW] messages.

STRICT RULES:
- Only mark a milestone "happened": true if a [NEW] message clearly shows it. When unsure, use false. False positives are much worse than false negatives.
- Sender ROLE is mandatory — a milestone does not count if the wrong role did it.
- IGNORE anything not about THIS deal's script or video: approvals of OTHER brands or partnerships (e.g. Meta), contract signing, payment, scheduling calls. The CREATOR saying "I approved X" is NEVER a script/draft approval — those must come FROM the AGENCY.
- A Google Docs link (docs.google.com) is a SCRIPT/CONCEPT. A Frame.io (f.io / frame.io) or Google Drive VIDEO link is a DRAFT. Do not confuse them.

Milestones:
- script_requested: an AGENCY [NEW] message asks the creator to send the script/concept.
- script_submitted: a CREATOR [NEW] message shares the script/concept for review (docs.google.com link, "here's the script/concept").
- script_approved: an AGENCY [NEW] message approves the script/concept or asks when content will be ready ("looks great", "when can we expect content?").
- draft_submitted: a CREATOR [NEW] message shares the edited video/draft for review (f.io / Google Drive video link, "video is ready for review").
- draft_approved: an AGENCY [NEW] message approves the draft to go live ("you're approved to go live", "when would you like to go live?").
- live_date_scheduled: a CREATOR [NEW] message proposes a specific FUTURE calendar date to publish ("I can post it Monday, June 15").
- posted_live: a CREATOR [NEW] message shares the published/live post link ("here's the posted video: instagram.com/...").

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "brand": string,                       // short brand name only (e.g. "Indeed", "ASUS", "OpenAI")
  "post_number": number | null,          // the video/post/concept number the NEW activity refers to (e.g. "Concept 3" -> 3, "Video 1" -> 1). null if unnumbered or not applicable.
  "milestones": {
    "script_requested":    { "happened": boolean, "evidence": string },
    "script_submitted":    { "happened": boolean, "evidence": string },
    "script_approved":     { "happened": boolean, "evidence": string },
    "draft_submitted":     { "happened": boolean, "evidence": string },
    "draft_approved":      { "happened": boolean, "evidence": string },
    "live_date_scheduled": { "happened": boolean, "evidence": string },
    "posted_live":         { "happened": boolean, "evidence": string }
  },
  "live_date": string | null,            // YYYY-MM-DD, only if live_date_scheduled is true AND the date is in the future; else null
  "confidence": number                   // 0-1
}
"evidence" is a short quote from the [NEW] message justifying "happened": true, or "" when false.`;

function buildTranscript(messages, recentIds) {
  return messages
    .map((m) => {
      const role = senderRole(m.from);
      const marker = recentIds.has(m.id) ? "NEW" : "context";
      const body = (m.body || "").replace(/\s+\n/g, "\n").trim().slice(0, 4000);
      return `--- MESSAGE (${role}) [${marker}] ---
From: ${m.from}
Date: ${m.date}
Subject: ${m.subject}

${body}`;
    })
    .join("\n\n");
}

export async function classifyThread(messages, recentIds = null) {
  // Default: treat only the single latest message as "new".
  const ids = recentIds || new Set([messages[messages.length - 1]?.id]);
  const transcript = buildTranscript(messages, ids);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: transcript }],
  });

  const text = response.content[0].text;
  const json = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(json);

  const result = {
    brand: parsed.brand || "",
    post_number: Number.isInteger(parsed.post_number) ? parsed.post_number : null,
    live_date: parsed.live_date || null,
    confidence: parsed.confidence ?? 1,
    evidence: {},
  };
  for (const key of MILESTONES) {
    const m = parsed.milestones?.[key] || {};
    result[key] = m.happened === true;
    result.evidence[key] = m.evidence || "";
  }
  return result;
}
