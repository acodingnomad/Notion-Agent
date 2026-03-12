import { Client } from "@notionhq/client";

const NOTION_TEXT_LIMIT = 2000;

function truncate(text, limit = NOTION_TEXT_LIMIT) {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}


export function createNotionClient(apiKey) {
  return new Client({ auth: apiKey });
}

export async function dealExistsInNotion(apiKey, databaseId, gmailId, title) {
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
          or: [
            { property: "Gmail ID", rich_text: { equals: gmailId } },
            { property: "Name", title: { equals: title } },
          ],
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
    name = `${deal.brand || "Unknown"} Post`,
    contentType = "BRAND POST",
    date = deal.posting_date,
    includePrice = true,
  } = options;

  const properties = {
    Name: { title: [{ text: { content: name } }] },
    Status: { status: { name: "Not started" } },
    "Type of Content": { select: { name: contentType } },
    Platforms: { multi_select: (deal.platforms || []).map((p) => ({ name: p })) },
    Deliverables: { rich_text: [{ text: { content: truncate(deal.deliverables || "") } }] },
    "Gmail ID": { rich_text: [{ text: { content: gmailId } }] },
  };

  if (options.rawPrice != null) {
    properties.Price = { number: options.rawPrice };
  } else if (includePrice && deal.rate) {
    properties.Price = { number: deal.rate * 0.8 };
  }

  if (date) {
    properties.Date = { date: { start: date } };
  }

  return notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });
}

export async function queryNotionByDateRange(apiKey, databaseId, startDate, endDate) {
  const pages = [];
  let cursor;

  do {
    const body = {
      filter: {
        and: [
          { property: "Date", date: { on_or_after: startDate } },
          { property: "Date", date: { on_or_before: endDate } },
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
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}
