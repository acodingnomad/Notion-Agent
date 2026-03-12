import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You extract brand deal information from emails. Return a JSON object with these fields:

- brand: string — the brand or company name
- platforms: string[] — list of platforms (e.g. ["Instagram Reel"], ["Instagram Reel", "TikTok"])
- posting_date: string | null — the posting/publish date in ISO format (YYYY-MM-DD) if mentioned, otherwise null
- deliverables: string — copy the full email body (excluding greeting/salutation and closing sign-off/name block). Include everything: deliverables, usage rights, exclusivity, creative briefs, rate, and all other details. IMPORTANT: strip all markdown formatting — remove asterisks (*), underscores (_), and any other markup. Use plain dashes (- ) for bullet points. Use ALL CAPS or a colon for section headers (e.g. "DELIVERABLES:" not "*Deliverables:*"). Output clean, readable plain text.
- rate: number | null — the monetary rate mentioned as a plain number without $ sign (e.g. 12000), or null if not mentioned
- post_count: number — the total number of individual content posts/videos required (e.g. "3x Reels" = 3, "2x TikToks" = 2). Default to 1 if not explicitly stated.

Return ONLY valid JSON, no markdown fences or extra text.`;

export async function extractBrandDeal(email) {
  const userMessage = `From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

${email.body}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].text;
  const json = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(json);
}
