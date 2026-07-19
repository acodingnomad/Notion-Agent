import { Client } from "@notionhq/client";

const NOTION_TEXT_LIMIT = 2000;

function truncate(text, limit = NOTION_TEXT_LIMIT) {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}


export function createNotionClient(apiKey) {
  return new Client({ auth: apiKey });
}

export async function dealExistsInNotion(apiKey, databaseId, gmailId) {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        filter: {
          property: "Gmail ID",
          rich_text: { equals: gmailId },
        },
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Notion API error (${response.status}): ${data.message}`);
  }
  return data.results.length > 0;
}

export async function writeDealToNotion(notion, databaseId, deal, gmailId, options = {}) {
  const {
    name = deal.brand || "Unknown",
    date = deal.posting_date,
  } = options;

  // One entry per deal. Stage + progress are advanced natively in Notion,
  // so we seed both to "Not started".
  const properties = {
    Name: { title: [{ text: { content: name } }] },
    "Deal Stage": { status: { name: "Not started" } },
    "Progress Status": { status: { name: "Not started" } },
    Platforms: { multi_select: (deal.platforms || []).map((p) => ({ name: p })) },
    Deliverables: { rich_text: [{ text: { content: truncate(deal.deliverables || "") } }] },
    "Gmail ID": { rich_text: [{ text: { content: gmailId } }] },
  };

  if (deal.rate) {
    properties.Price = { number: deal.rate * 0.8 };
  }

  if (date) {
    properties["Posting Date"] = { date: { start: date } };
  }

  return notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });
}

// Returns the names of existing entries for a brand within ±90 days of the
// email date, used to avoid creating duplicate entries.
export async function getExistingBrandEntries(apiKey, databaseId, brandName, emailDate) {
  const date = new Date(emailDate);
  const before = new Date(date);
  before.setDate(before.getDate() - 90);
  const after = new Date(date);
  after.setDate(after.getDate() + 90);

  const startDate = before.toISOString().split("T")[0];
  const endDate = after.toISOString().split("T")[0];

  const names = [];
  let cursor;

  do {
    const body = {
      filter: {
        and: [
          { property: "Name", title: { contains: brandName } },
          { property: "Posting Date", date: { on_or_after: startDate } },
          { property: "Posting Date", date: { on_or_before: endDate } },
        ],
      },
    };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Notion API error (${response.status}): ${data.message}`);
    }

    for (const page of data.results) {
      const name = (page.properties?.Name?.title || []).map((t) => t.plain_text).join("");
      names.push(name);
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return names;
}
