import "dotenv/config";
import { createGmailClient, getLabelId, getEmailsByLabel } from "./gmail.js";
import { extractBrandDeal } from "./extract.js";
import { createNotionClient, writeDealToNotion, dealExistsInNotion } from "./notion.js";

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
  if (dryRun) console.log("DRY RUN — will not write to Notion.");

  for (const email of emails) {
    try {
      console.log(`Processing: ${email.subject}`);

      if (filter && !email.subject.toLowerCase().includes(filter.toLowerCase())) {
        continue;
      }

      const deal = await extractBrandDeal(email);
      const postCount = deal.post_count || 1;
      const perPostRate = deal.rate ? deal.rate / postCount : null;
      const baseDate = deal.posting_date || addDays(email.date, 14);

      const firstTitle = postCount > 1
        ? `${deal.brand || "Unknown"} 1 Post`
        : `${deal.brand || "Unknown"} Post`;

      if (!dryRun) {
        const exists = await dealExistsInNotion(process.env.NOTION_API_KEY, databaseId, email.id, firstTitle);
        if (exists) {
          console.log(`  -> Already in Notion, skipping.`);
          continue;
        }
      }

      const brand = deal.brand || "Unknown";
      const today = new Date().toISOString().split("T")[0];
      const scriptDate = addDays(today, 7);

      // Define all entries to create
      const entries = [];

      // 1 Script (shared, not per-post)
      entries.push({
        name: `${brand} Script`,
        contentType: "SCRIPT",
        date: scriptDate,
        includePrice: false,
        rate: null,
      });

      for (let i = 0; i < postCount; i++) {
        const label = postCount > 1 ? `${brand} ${i + 1}` : brand;
        const filmDate = addDays(scriptDate, 7 + i * 7);
        const draftDate = addDays(filmDate, 1);
        const postDate = addDays(baseDate, i * 7);

        // Filming
        entries.push({
          name: `TO DO: Film ${label}`,
          contentType: "📸 FILMING DAY",
          date: filmDate,
          includePrice: false,
          rate: null,
        });

        // Draft
        entries.push({
          name: `${label} Draft`,
          contentType: "DRAFT DUE",
          date: draftDate,
          includePrice: false,
          rate: null,
        });

        // Post
        entries.push({
          name: `${label} Post`,
          contentType: "BRAND POST",
          date: postDate,
          includePrice: true,
          rate: perPostRate,
        });
      }

      // Write all entries
      for (const entry of entries) {
        const entryDeal = { ...deal, rate: entry.rate };
        if (dryRun) {
          console.log(`  -> [dry run] ${entry.name} | ${entry.contentType} | ${entry.date} | price: ${entry.includePrice}`);
        } else {
          await writeDealToNotion(notion, databaseId, entryDeal, email.id, {
            name: entry.name,
            contentType: entry.contentType,
            date: entry.date,
            includePrice: entry.includePrice,
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
