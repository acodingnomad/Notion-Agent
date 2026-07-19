import "dotenv/config";
import { createGmailClient, getLabelId, getEmailsByLabel } from "./gmail.js";
import { extractBrandDeal } from "./extract.js";
import { createNotionClient, writeDealToNotion, dealExistsInNotion, getExistingBrandEntries } from "./notion.js";

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

const dryRun = process.argv.includes("--dry-run");
const filterArg = process.argv.find((a) => a.startsWith("--filter="));
const filter = filterArg ? filterArg.split("=")[1] : null;

export async function main() {
  const required = [
    "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET",
    "GMAIL_REDIRECT_URI", "GMAIL_REFRESH_TOKEN",
    "ANTHROPIC_API_KEY", "NOTION_API_KEY", "NOTION_DATABASE_ID",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const gmail = createGmailClient({
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  });

  const notion = createNotionClient(process.env.NOTION_API_KEY);
  const databaseId = process.env.NOTION_DATABASE_ID?.split("?")[0];
  const labelName = process.env.GMAIL_LABEL || "in progress";

  console.log(`Fetching emails with label "${labelName}"...`);
  let labelId, emails;
  try {
    labelId = await getLabelId(gmail, labelName);
    emails = await getEmailsByLabel(gmail, labelId);
  } catch (err) {
    if (err.message?.includes("invalid_grant")) {
      console.error("Gmail auth failed — refresh token is expired or revoked.");
      console.error('Run "npm run auth" to re-authorize, then update GMAIL_REFRESH_TOKEN in .env.');
      process.exit(1);
    }
    throw err;
  }
  console.log(`Found ${emails.length} email(s).`);

  // Layer 1: Deduplicate by threadId — keep only the latest email per thread
  const threadMap = new Map();
  for (const email of emails) {
    const key = email.threadId || email.id;
    const existing = threadMap.get(key);
    if (!existing || new Date(email.date) > new Date(existing.date)) {
      threadMap.set(key, email);
    }
  }
  const dedupedEmails = [...threadMap.values()];
  if (dedupedEmails.length < emails.length) {
    console.log(`Deduped ${emails.length} → ${dedupedEmails.length} emails (by thread).`);
  }

  if (dryRun) console.log("DRY RUN — will not write to Notion.");

  // Layer 2: Track brands processed in this run
  const processedBrands = new Set();

  for (const email of dedupedEmails) {
    try {
      console.log(`Processing: ${email.subject}`);

      if (filter && !email.subject.toLowerCase().includes(filter.toLowerCase())) {
        continue;
      }

      // Skip early (before the AI extraction call) if this exact email was
      // already turned into a deal — saves tokens on unchanged threads.
      if (!dryRun) {
        const exists = await dealExistsInNotion(process.env.NOTION_API_KEY, databaseId, email.id);
        if (exists) {
          console.log(`  -> Already in Notion (Gmail ID match), skipping.`);
          continue;
        }
      }

      const deal = await extractBrandDeal(email);

      // Layer 2: Skip if we already processed this brand in this run
      const brandKey = (deal.brand || "").toLowerCase();
      if (brandKey && processedBrands.has(brandKey)) {
        console.log(`  -> Brand "${deal.brand}" already processed this run, skipping.`);
        continue;
      }
      if (brandKey) processedBrands.add(brandKey);

      const brand = deal.brand || "Unknown";
      const postCount = deal.post_count || 1;
      const perPostRate = deal.rate ? deal.rate / postCount : null;
      const baseDate = deal.posting_date || addDays(email.date, 14);

      // Per-post platforms: when an Instagram Story rides alongside video posts,
      // it attaches to post 1 only. Story-only or video-only deals get the full list.
      const STORY = "Instagram Story";
      const allPlatforms = deal.platforms || [];
      const nonStoryPlatforms = allPlatforms.filter((p) => p !== STORY);
      const storyRidesOnPost = allPlatforms.includes(STORY) && nonStoryPlatforms.length > 0;
      const platformsForPost = (i) =>
        storyRidesOnPost ? (i === 0 ? allPlatforms : nonStoryPlatforms) : allPlatforms;

      // One entry per post/deliverable. Stage + progress are tracked on the
      // single entry (and advanced natively in Notion), so we just seed both
      // to "Not started".
      const entries = [];
      for (let i = 0; i < postCount; i++) {
        const label = postCount > 1 ? `${brand} ${i + 1}` : brand;
        entries.push({
          name: label,
          date: addDays(baseDate, i * 7),
          rate: perPostRate,
          platforms: platformsForPost(i),
        });
      }

      // Gap-fill: only write entries whose name isn't already in Notion for this brand.
      let entriesToWrite = entries;
      if (!dryRun && brandKey) {
        const existingNames = new Set(
          (await getExistingBrandEntries(process.env.NOTION_API_KEY, databaseId, deal.brand, email.date))
            .map((n) => n.toLowerCase())
        );
        entriesToWrite = entries.filter((e) => !existingNames.has(e.name.toLowerCase()));
        if (entriesToWrite.length === 0) {
          console.log(`  -> All entries already exist for "${brand}", skipping.`);
          continue;
        }
        if (entriesToWrite.length < entries.length) {
          console.log(`  -> Writing ${entriesToWrite.length}/${entries.length} missing entries for "${brand}".`);
        }
      }

      for (const entry of entriesToWrite) {
        const entryDeal = { ...deal, rate: entry.rate, platforms: entry.platforms ?? deal.platforms };
        if (dryRun) {
          console.log(`  -> [dry run] ${entry.name} | ${entry.date} | platforms: [${(entry.platforms || []).join(", ")}] | price: ${entry.rate != null}`);
        } else {
          await writeDealToNotion(notion, databaseId, entryDeal, email.id, {
            name: entry.name,
            date: entry.date,
          });
          console.log(`  -> Written: ${entry.name}`);
        }
      }
    } catch (err) {
      console.error(`  -> Failed for "${email.subject}": ${err.message}`);
    }
  }

  console.log("Done.");
}

// Only run directly when this file is the entry point
const isDirectRun = process.argv[1]?.endsWith("index.js");
if (isDirectRun) main();
