import "dotenv/config";
import {
  createGmailClient,
  getLabelId,
  getThreadIdsByLabel,
  getThreadMessages,
} from "./gmail.js";
import { classifyThread } from "./classify.js";
import {
  createNotionClient,
  getBrandStagePages,
  getPagesByGmailIds,
  getActiveStagePages,
  updatePageStatus,
  updatePagePostingDate,
} from "./notion.js";

// Forward-only status pipelines per stage. Order === progression.
// A page is only ever moved to a HIGHER index, never a lower one.
const STAGE_ORDER = {
  SCRIPT: ["Not started", "Due next", "Awaiting approval", "Done"],
  FILMING: ["Not started", "Ready to film", "Done"],
  DRAFT: ["Not started", "Ready for editing", "Awaiting approval", "Done"],
  POST: ["Not started", "Ready to post", "Scheduled", "Done"],
};

const MILESTONE_KEYS = [
  "script_requested", "script_submitted", "script_approved",
  "draft_submitted", "draft_approved", "live_date_scheduled", "posted_live",
];

function stageOf(contentType) {
  if (!contentType) return null;
  const c = contentType.toUpperCase();
  if (c.includes("SCRIPT")) return "SCRIPT";
  if (c.includes("FILM")) return "FILMING"; // "FILM" (current) or legacy "FILMING DAY"
  if (c.includes("DRAFT")) return "DRAFT";
  if (c.includes("POST")) return "POST";
  return null; // e.g. "Organic Content"
}

function numberOf(name) {
  const m = (name || "").match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function canAdvance(order, current, target) {
  const ci = order.indexOf(current);
  const ti = order.indexOf(target);
  if (ti === -1) return false; // invalid target
  if (ci === -1) return false; // manual/unknown status (e.g. "Update requested") — leave alone
  return ti > ci;
}

// Progressive brand name variants for fallback matching, most specific first.
// e.g. "OpenAI (ChatGPT Codex)" -> ["OpenAI (ChatGPT Codex)", "OpenAI"]
function brandVariants(brand) {
  const b = (brand || "").trim();
  const variants = [b, b.split("(")[0].trim(), b.split(/\s+/)[0]];
  return [...new Set(variants)].filter((v) => v && v.length >= 2);
}

// Earliest = by posting date (nulls last), then name.
function sortEarliest(pages) {
  return [...pages].sort((a, b) => {
    const da = a.postingDate || "9999-99-99";
    const db = b.postingDate || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  });
}

// Milestone -> stage transitions. scope "all" hits every advanceable page of
// that stage; "earliest" advances only the earliest pending one (FIFO).
const TRANSITIONS = [
  { flag: "script_requested", stage: "SCRIPT", target: "Due next", scope: "earliest" },
  { flag: "script_submitted", stage: "SCRIPT", target: "Awaiting approval", scope: "earliest" },
  { flag: "script_approved", stage: "SCRIPT", target: "Done", scope: "earliest" },
  { flag: "script_approved", stage: "FILMING", target: "Ready to film", scope: "all" },
  { flag: "draft_submitted", stage: "DRAFT", target: "Awaiting approval", scope: "earliest" },
  { flag: "draft_approved", stage: "DRAFT", target: "Done", scope: "earliest" },
  { flag: "draft_approved", stage: "POST", target: "Ready to post", scope: "earliest" },
  { flag: "live_date_scheduled", stage: "POST", target: "Ready to post", scope: "earliest" },
  { flag: "posted_live", stage: "POST", target: "Done", scope: "earliest" },
];

// Build the set of status changes for one brand's pages given classified signals.
export function planBrandUpdates(signals, rawPages) {
  const pages = rawPages
    .map((p) => ({ ...p, stage: stageOf(p.contentType), number: numberOf(p.name) }))
    .filter((p) => p.stage);

  const byStage = { SCRIPT: [], FILMING: [], DRAFT: [], POST: [] };
  for (const p of pages) byStage[p.stage].push(p);

  // pageId -> { page, order, targetIndex, reasons: [] }
  const planned = new Map();

  const propose = (page, target, reason) => {
    const order = STAGE_ORDER[page.stage];
    if (!canAdvance(order, page.status, target)) return;
    const ti = order.indexOf(target);
    const existing = planned.get(page.id);
    if (!existing || ti > existing.targetIndex) {
      planned.set(page.id, { page, order, targetIndex: ti, reasons: [reason] });
    } else if (ti === existing.targetIndex) {
      existing.reasons.push(reason);
    }
  };

  // 1) Email-driven transitions
  const num = Number.isInteger(signals.post_number) ? signals.post_number : null;
  for (const t of TRANSITIONS) {
    if (!signals[t.flag]) continue;
    let candidates = byStage[t.stage].filter((p) =>
      canAdvance(STAGE_ORDER[t.stage], p.status, t.target)
    );
    if (candidates.length === 0) continue;
    // If the thread names a specific post number, target that page precisely.
    if (num != null && t.scope !== "all") {
      const numbered = candidates.filter((p) => p.number === num);
      if (numbered.length) candidates = numbered;
    }
    const chosen = t.scope === "all" ? candidates : [sortEarliest(candidates)[0]];
    for (const page of chosen) propose(page, t.target, t.flag);
  }

  // 2) Notion-driven cascade: FILMING marked Done -> matching DRAFT "Ready for editing"
  for (const film of byStage.FILMING) {
    if (film.status !== "Done") continue;
    const match =
      byStage.DRAFT.find((d) => d.number === film.number) ||
      (byStage.DRAFT.length === 1 ? byStage.DRAFT[0] : null);
    if (match) propose(match, "Ready for editing", "filming_done_cascade");
  }

  const statusChanges = [...planned.values()].map((v) => ({
    page: v.page,
    from: v.page.status,
    to: v.order[v.targetIndex],
    reasons: v.reasons,
  }));

  // 3) Posting date: when a live date is scheduled, set it on the earliest
  //    not-yet-posted BRAND POST page. Guardrails: only accept a plausible
  //    FUTURE date so noisy extraction can't overwrite a good date with a
  //    past/garbage one.
  const dateChanges = [];
  const today = new Date().toISOString().split("T")[0];
  if (
    signals.live_date_scheduled &&
    signals.live_date &&
    /^\d{4}-\d{2}-\d{2}$/.test(signals.live_date) &&
    signals.live_date >= today
  ) {
    const target = sortEarliest(byStage.POST.filter((p) => p.status !== "Done"))[0];
    if (target && target.postingDate !== signals.live_date) {
      dateChanges.push({ page: target, from: target.postingDate, to: signals.live_date });
    }
  }

  return { statusChanges, dateChanges };
}

// The "deliverable core" is the shared part of a page name across stages, e.g.
// "TO DO: Film Flodesk 1", "Flodesk 1 Draft", "Flodesk 1 Post" all -> "Flodesk 1".
// This lets us match sibling pages of the same deliverable reliably by name.
function deliverableCore(name, stage) {
  let s = (name || "").trim();
  if (stage === "FILMING") s = s.replace(/^to\s*do:\s*/i, "").replace(/^film\s+/i, "");
  else if (stage === "DRAFT") s = s.replace(/\s+draft$/i, "");
  else if (stage === "POST") s = s.replace(/\s+post$/i, "");
  else if (stage === "SCRIPT") s = s.replace(/\s+scripts?\b.*$/i, "").replace(/\s+outline\b.*$/i, "");
  return s.trim().toLowerCase();
}

// Notion-driven cascades: when YOU set a page's status to "Done" in Notion,
// advance the next stage. Purely status-based (no email needed), forward-only,
// matched by exact deliverable name (e.g. "Flodesk 1").
//   FILMING Done -> DRAFT "Ready for editing"
//   DRAFT Done   -> POST  "Ready to post"
// (Script -> Filming is intentionally NOT here: it's driven by agency email
//  approval, and marking one of several scripts Done shouldn't ready all
//  filming days.)
export function planNotionCascades(rawPages) {
  const pages = rawPages
    .map((p) => {
      const stage = stageOf(p.contentType);
      return { ...p, stage, core: stage ? deliverableCore(p.name, stage) : null };
    })
    .filter((p) => p.stage);

  const byStage = { SCRIPT: [], FILMING: [], DRAFT: [], POST: [] };
  for (const p of pages) byStage[p.stage].push(p);

  const planned = new Map();
  const propose = (page, target, reason) => {
    const order = STAGE_ORDER[page.stage];
    if (!canAdvance(order, page.status, target)) return;
    const ti = order.indexOf(target);
    const existing = planned.get(page.id);
    if (!existing || ti > existing.targetIndex) {
      planned.set(page.id, { page, order, targetIndex: ti, reason });
    }
  };

  for (const f of byStage.FILMING) {
    if (f.status !== "Done") continue;
    for (const d of byStage.DRAFT) {
      if (d.core === f.core) propose(d, "Ready for editing", "filming_done_cascade");
    }
  }
  for (const d of byStage.DRAFT) {
    if (d.status !== "Done") continue;
    for (const p of byStage.POST) {
      if (p.core === d.core) propose(p, "Ready to post", "draft_done_cascade");
    }
  }

  return [...planned.values()].map((v) => ({
    page: v.page,
    from: v.page.status,
    to: v.order[v.targetIndex],
    reason: v.reason,
  }));
}

// Messages newer than this many days count as "new" activity to react to.
const RECENT_DAYS = Number(process.env.SYNC_RECENT_DAYS || 3);

// Pick which messages count as "new". Anything within the window; if nothing is
// that recent, fall back to just the single latest message.
function recentMessageIds(messages, days = RECENT_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = messages.filter((m) => m.internalDate >= cutoff);
  const chosen = recent.length ? recent : messages.slice(-1);
  return new Set(chosen.map((m) => m.id));
}

export async function syncStatuses({ dryRun = false, filter = null } = {}) {
  const gmail = createGmailClient({
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  });
  const notion = createNotionClient(process.env.NOTION_API_KEY);
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID?.split("?")[0];
  const labelName = process.env.GMAIL_LABEL || "in progress";

  console.log(`\n=== Status sync (label "${labelName}"${dryRun ? ", DRY RUN" : ""}) ===`);

  const labelId = await getLabelId(gmail, labelName);
  const threadIds = await getThreadIdsByLabel(gmail, labelId);
  console.log(`Found ${threadIds.length} thread(s) to inspect.`);

  let totalChanges = 0;

  for (const threadId of threadIds) {
    try {
      const messages = await getThreadMessages(gmail, threadId);
      if (messages.length === 0) continue;

      const subject = messages[messages.length - 1].subject;
      if (filter && !subject.toLowerCase().includes(filter.toLowerCase())) continue;

      // Match this thread to its Notion pages by Gmail message ID (exact).
      const msgIds = messages.map((m) => m.id);
      let pages = await getPagesByGmailIds(apiKey, databaseId, msgIds);

      const recentIds = recentMessageIds(messages);
      const signals = await classifyThread(messages, recentIds);
      const brand = (signals.brand || "").trim();

      // Fallback: brand-name variants if no exact ID match.
      if (pages.length === 0 && brand) {
        for (const variant of brandVariants(brand)) {
          pages = await getBrandStagePages(apiKey, databaseId, variant);
          if (pages.length > 0) break;
        }
      }

      const anyMilestone =
        signals.script_requested || signals.script_submitted || signals.script_approved ||
        signals.draft_submitted || signals.draft_approved ||
        signals.live_date_scheduled || signals.posted_live;

      if (!brand || (signals.confidence ?? 1) < 0.5 || !anyMilestone) {
        console.log(`\n[${subject}] -> "${brand || "?"}": no actionable signal, skipping.`);
        continue;
      }

      if (pages.length === 0) {
        console.log(`\n[${brand}] no Notion pages found (deal not created yet?), skipping.`);
        continue;
      }

      const { statusChanges, dateChanges } = planBrandUpdates(signals, pages);

      const activeFlags = MILESTONE_KEYS.filter((k) => signals[k] === true);
      const numLabel = signals.post_number != null ? ` (post #${signals.post_number})` : "";
      console.log(`\n[${brand}]${numLabel} signals: ${activeFlags.join(", ") || "none"}`);
      for (const k of activeFlags) {
        const ev = signals.evidence?.[k];
        if (ev) console.log(`    - ${k}: "${ev}"`);
      }

      if (statusChanges.length === 0 && dateChanges.length === 0) {
        console.log(`  Nothing to update (already up to date).`);
        continue;
      }

      for (const c of statusChanges) {
        console.log(`  ${dryRun ? "[dry run] " : ""}${c.page.name}: "${c.from}" -> "${c.to}"  (${c.reasons.join(", ")})`);
        if (!dryRun) await updatePageStatus(notion, c.page.id, c.to);
        totalChanges++;
      }
      for (const c of dateChanges) {
        console.log(`  ${dryRun ? "[dry run] " : ""}${c.page.name}: Posting Date "${c.from || "none"}" -> "${c.to}"`);
        if (!dryRun) await updatePagePostingDate(notion, c.page.id, c.to);
        totalChanges++;
      }
    } catch (err) {
      console.error(`  Thread ${threadId} failed: ${err.message}`);
    }
  }

  // Notion-driven cascades: react to statuses you set manually in Notion
  // (e.g. Filming -> Done cascades the matching Draft to "Ready for editing").
  // Scans active deals directly, independent of Gmail.
  try {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 120);
    const end = new Date(today);
    end.setDate(end.getDate() + 365);
    const startDate = start.toISOString().split("T")[0];
    const endDate = end.toISOString().split("T")[0];

    const activePages = await getActiveStagePages(apiKey, databaseId, startDate, endDate);
    const cascades = planNotionCascades(activePages);
    if (cascades.length) {
      console.log(`\n=== Notion status triggers ===`);
      for (const c of cascades) {
        console.log(`  ${dryRun ? "[dry run] " : ""}${c.page.name}: "${c.from}" -> "${c.to}"  (${c.reason})`);
        if (!dryRun) await updatePageStatus(notion, c.page.id, c.to);
        totalChanges++;
      }
    }
  } catch (err) {
    console.error(`  Notion cascade pass failed: ${err.message}`);
  }

  console.log(`\nStatus sync done. ${totalChanges} change(s)${dryRun ? " (dry run)" : ""}.`);
}

const isDirectRun = process.argv[1]?.endsWith("status-sync.js");
if (isDirectRun) {
  const dryRun = process.argv.includes("--dry-run");
  const filterArg = process.argv.find((a) => a.startsWith("--filter="));
  const filter = filterArg ? filterArg.split("=")[1] : null;
  syncStatuses({ dryRun, filter }).catch((err) => {
    console.error("Status sync failed:", err.message);
    process.exit(1);
  });
}
