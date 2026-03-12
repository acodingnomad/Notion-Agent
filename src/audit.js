import "dotenv/config";
import { createNotionClient, queryNotionByDateRange, writeDealToNotion } from "./notion.js";

// --- Property extraction helpers ---

function getTitle(page) {
  const prop = page.properties.Name;
  return prop?.title?.[0]?.plain_text || "";
}

function getContentType(page) {
  return page.properties["Type of Content"]?.select?.name || "";
}

function getDate(page) {
  return page.properties.Date?.date?.start || null;
}

function getPlatforms(page) {
  return (page.properties.Platforms?.multi_select || []).map((s) => s.name);
}

function getDeliverables(page) {
  return page.properties.Deliverables?.rich_text?.[0]?.plain_text || "";
}

function getGmailId(page) {
  return page.properties["Gmail ID"]?.rich_text?.[0]?.plain_text || "";
}

function getPrice(page) {
  return page.properties.Price?.number ?? null;
}

function getStatus(page) {
  return page.properties.Status?.status?.name || "";
}

// --- Brand parsing ---

const STAGE_PATTERNS = {
  SCRIPT: /^(.+?)\s+Script$/i,
  FILMING: /^TO DO: Film\s+(.+?)(?:\s+(\d+))?$/i,
  DRAFT: /^(.+?)(?:\s+(\d+))?\s+Draft$/i,
  POST: /^(.+?)(?:\s+(\d+))?\s+Post$/i,
};

function parseBrandFromEntry(title, contentType) {
  // Try matching by content type first for accuracy
  if (contentType === "SCRIPT") {
    const m = title.match(STAGE_PATTERNS.SCRIPT);
    if (m) return { brand: m[1].trim(), stage: "SCRIPT", number: null };
  }

  if (contentType === "📸 FILMING DAY") {
    const m = title.match(STAGE_PATTERNS.FILMING);
    if (m) return { brand: m[1].trim(), stage: "FILMING", number: m[2] ? parseInt(m[2]) : null };
  }

  if (contentType === "DRAFT DUE") {
    const m = title.match(STAGE_PATTERNS.DRAFT);
    if (m) return { brand: m[1].trim(), stage: "DRAFT", number: m[2] ? parseInt(m[2]) : null };
  }

  if (contentType === "BRAND POST") {
    const m = title.match(STAGE_PATTERNS.POST);
    if (m) return { brand: m[1].trim(), stage: "POST", number: m[2] ? parseInt(m[2]) : null };
  }

  // Fallback: try all patterns regardless of contentType
  for (const [stage, pattern] of Object.entries(STAGE_PATTERNS)) {
    const m = title.match(pattern);
    if (m) {
      return {
        brand: m[1].trim(),
        stage,
        number: m[2] ? parseInt(m[2]) : null,
      };
    }
  }

  return null;
}

// --- Grouping ---

function groupByBrand(pages) {
  const groups = {};

  for (const page of pages) {
    const title = getTitle(page);
    const contentType = getContentType(page);
    const parsed = parseBrandFromEntry(title, contentType);
    if (!parsed) continue;

    const key = parsed.brand.toLowerCase();
    if (!groups[key]) {
      groups[key] = { brand: parsed.brand, entries: [] };
    }
    groups[key].entries.push({
      ...parsed,
      page,
      title,
      date: getDate(page),
      status: getStatus(page),
    });
  }

  return groups;
}

// --- Gap detection ---

function findGaps(group) {
  const { entries } = group;
  const missing = [];

  // Skip brands where all Post entries are already "Done"
  const postEntries = entries.filter((e) => e.stage === "POST");
  if (postEntries.length > 0 && postEntries.every((e) => e.status === "Done")) {
    return [];
  }

  // Determine post count from highest numbered entry (or 1 if none numbered)
  let postCount = 1;
  for (const e of entries) {
    if (e.number && e.number > postCount) postCount = e.number;
  }

  // Check script exists
  const hasScript = entries.some((e) => e.stage === "SCRIPT");
  if (!hasScript) missing.push({ stage: "SCRIPT", number: null });

  // For each post 1..N check filming, draft, post
  for (let i = 1; i <= postCount; i++) {
    const num = postCount > 1 ? i : null;
    for (const stage of ["FILMING", "DRAFT", "POST"]) {
      const exists = entries.some((e) => {
        if (e.stage !== stage) return false;
        if (postCount === 1) return true; // single-post: any match counts
        return e.number === i;
      });
      if (!exists) missing.push({ stage, number: num });
    }
  }

  return missing;
}

// --- Extract sibling data for backfill ---

function extractSiblingData(group) {
  const { entries } = group;
  let platforms = [];
  let deliverables = "";
  let gmailId = "";
  let price = null;

  for (const e of entries) {
    if (!platforms.length) platforms = getPlatforms(e.page);
    if (!deliverables) deliverables = getDeliverables(e.page);
    if (!gmailId) gmailId = getGmailId(e.page);
    if (price == null) price = getPrice(e.page);
  }

  return { platforms, deliverables, gmailId, price };
}

// --- Date assignment ---

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function findDate(entries, stage, number) {
  return entries.find((e) => {
    if (e.stage !== stage) return false;
    if (number == null) return true;
    return e.number === number || e.number == null;
  })?.date || null;
}

function assignDate(group, stage, number) {
  const { entries } = group;

  const scriptDate = findDate(entries, "SCRIPT", null);
  const filmDate = findDate(entries, "FILMING", number);
  const draftDate = findDate(entries, "DRAFT", number);
  const postDate = findDate(entries, "POST", number);

  switch (stage) {
    case "SCRIPT":
      if (filmDate) return addDays(filmDate, -7);
      if (draftDate) return addDays(draftDate, -8);
      if (postDate) return addDays(postDate, -14);
      break;
    case "FILMING":
      if (scriptDate) return addDays(scriptDate, 7);
      if (draftDate) return addDays(draftDate, -1);
      if (postDate) return addDays(postDate, -7);
      break;
    case "DRAFT":
      if (filmDate) return addDays(filmDate, 1);
      if (scriptDate) return addDays(scriptDate, 8);
      if (postDate) return addDays(postDate, -6);
      break;
    case "POST":
      if (draftDate) return addDays(draftDate, 6);
      if (filmDate) return addDays(filmDate, 7);
      if (scriptDate) return addDays(scriptDate, 14);
      break;
  }

  return null;
}

// --- Entry creation mapping ---

function buildEntryName(brand, stage, number) {
  const label = number ? `${brand} ${number}` : brand;
  switch (stage) {
    case "SCRIPT": return `${brand} Script`;
    case "FILMING": return `TO DO: Film ${label}`;
    case "DRAFT": return `${label} Draft`;
    case "POST": return `${label} Post`;
  }
}

const STAGE_CONTENT_TYPES = {
  SCRIPT: "SCRIPT",
  FILMING: "📸 FILMING DAY",
  DRAFT: "DRAFT DUE",
  POST: "BRAND POST",
};

// --- Report ---

function printReport(groups, allGaps) {
  const brands = Object.keys(groups).sort();
  if (!brands.length) {
    console.log("No deals found in the given date range.");
    return;
  }

  console.log(`\nFound ${brands.length} brand(s):\n`);

  for (const key of brands) {
    const group = groups[key];
    const gaps = allGaps[key];
    const stages = group.entries.map((e) => {
      const num = e.number ? ` ${e.number}` : "";
      return `${e.stage}${num}`;
    });

    if (gaps.length === 0) {
      console.log(`  ${group.brand}: ${stages.join(", ")} — complete`);
    } else {
      const missingLabels = gaps.map((g) => {
        const num = g.number ? ` ${g.number}` : "";
        return `${g.stage}${num}`;
      });
      console.log(`  ${group.brand}: ${stages.join(", ")}`);
      console.log(`    MISSING: ${missingLabels.join(", ")}`);
    }
  }

  const totalGaps = Object.values(allGaps).reduce((sum, g) => sum + g.length, 0);
  console.log(`\nTotal missing entries: ${totalGaps}`);
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const dryRun = args.includes("--dry-run");
  const monthArg = args.find((a) => a.startsWith("--month="));
  const month = monthArg ? monthArg.split("=")[1] : "2026-03";
  const afterArg = args.find((a) => a.startsWith("--after="));
  const afterDate = afterArg ? afterArg.split("=")[1] : new Date().toISOString().split("T")[0];

  // Parse month into date range, narrowed by --after (default: today)
  const [year, mon] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const afterPlusOne = addDays(afterDate, 1);
  const startDate = afterPlusOne > monthStart ? afterPlusOne : monthStart;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  console.log(`Auditing Notion deals for ${month} (${startDate} to ${endDate})...`);

  const apiKey = process.env.NOTION_API_KEY;
  const notion = createNotionClient(apiKey);
  const databaseId = process.env.NOTION_DATABASE_ID?.split("?")[0];

  const pages = await queryNotionByDateRange(apiKey, databaseId, startDate, endDate);
  console.log(`Fetched ${pages.length} page(s) from Notion.`);

  const groups = groupByBrand(pages);
  const allGaps = {};
  for (const key of Object.keys(groups)) {
    allGaps[key] = findGaps(groups[key]);
  }

  printReport(groups, allGaps);

  if (!fix) {
    if (Object.values(allGaps).some((g) => g.length > 0)) {
      console.log("\nRun with --fix to create missing entries (add --dry-run to preview).");
    }
    return;
  }

  // Fix mode
  const totalGaps = Object.values(allGaps).reduce((sum, g) => sum + g.length, 0);
  if (totalGaps === 0) {
    console.log("\nNothing to fix — all deals are complete.");
    return;
  }

  console.log(`\n${dryRun ? "DRY RUN — " : ""}Creating ${totalGaps} missing entry/entries...\n`);

  for (const key of Object.keys(groups).sort()) {
    const group = groups[key];
    const gaps = allGaps[key];
    if (!gaps.length) continue;

    const sibling = extractSiblingData(group);

    for (const gap of gaps) {
      const name = buildEntryName(group.brand, gap.stage, gap.number);
      const contentType = STAGE_CONTENT_TYPES[gap.stage];
      const date = assignDate(group, gap.stage, gap.number);
      const includePrice = gap.stage === "POST";

      if (dryRun) {
        console.log(`  [dry run] ${name} | ${contentType} | ${date || "no date"} | price: ${includePrice ? sibling.price : "n/a"}`);
        continue;
      }

      const deal = {
        brand: group.brand,
        platforms: sibling.platforms,
        deliverables: sibling.deliverables,
      };

      const options = {
        name,
        contentType,
        date,
        includePrice: false, // we handle price via rawPrice
      };

      if (includePrice && sibling.price != null) {
        options.rawPrice = sibling.price;
      }

      await writeDealToNotion(notion, databaseId, deal, sibling.gmailId, options);
      console.log(`  Created: ${name} | ${date || "no date"}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});
