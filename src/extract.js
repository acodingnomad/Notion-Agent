import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You extract brand deal information from emails. Return a JSON object with these fields:

- brand: string — the brand or company name
- platforms: string[] — list of platforms (e.g. ["Instagram Reel"], ["TikTok", "YouTube Shorts"]). Valid values: "Instagram Reel", "Instagram Carousel", "Instagram Story", "TikTok", "YouTube Shorts", "YouTube", "X", "LinkedIn", "UGC"
- posting_date: string | null — the posting/publish date in ISO format (YYYY-MM-DD) if mentioned, otherwise null
- deliverables: string — copy the full email body (excluding greeting/salutation and closing sign-off/name block). Include everything: deliverables, usage rights, exclusivity, creative briefs, rate, and all other details. IMPORTANT: strip all markdown formatting — remove asterisks (*), underscores (_), and any other markup. Use plain dashes (- ) for bullet points. Use ALL CAPS or a colon for section headers (e.g. "DELIVERABLES:" not "*Deliverables:*"). Output clean, readable plain text.
- rate: number | null — the monetary rate mentioned as a plain number without $ sign (e.g. 12000), or null if not mentioned
- post_count: number — the total number of individual content posts/videos required (e.g. "3x Reels" = 3, "2x TikToks" = 2). Default to 1 if not explicitly stated.
- formats_by_post: string[][] — one array for each entry counted in post_count, in the same order. Valid values are only "9:16", "16:9", "4:5", "Story Set", and "raw".

  FORMAT RULES:
  - Capture every required aspect ratio listed for a video, regardless of platform. Multiple exports of the same video count as one video.
  - When the email says "Each video delivered in 3 formats: 9:16, 16:9 and 4:5", include ["9:16", "16:9", "4:5"] in formats_by_post for each covered video. If a requirement names a specific video, apply it only to that video.
  - Recognize equivalent export dimensions: 1080x1920 → "9:16", 1920x1080 → "16:9", and 1080x1350 → "4:5".
  - For example, "one 1080x1920 Reel plus three IG Story frames; send the original unedited clips too" gives ["9:16", "Story Set", "raw"] for that Reel. A request for unedited source clips alone gives ["raw"].
  - Use "9:16" for vertical video deliverables such as Instagram Reels, TikToks, and YouTube Shorts.
  - Use "16:9" for standard horizontal YouTube videos or integrations.
  - Use "4:5" for Instagram Carousel deliverables or when a 4:5 feed format is explicitly required.
  - Use "Story Set" when Instagram Story frames or a story set are required. Attach it to the corresponding video entry when stories are add-ons.
  - Use "raw" only when raw footage/files are explicitly required; never infer it merely because the content is UGC.
  - A post can have multiple formats (for example, a Reel plus Story Set is ["9:16", "Story Set"]).
  - Use an empty array when no allowed format can be determined. Never invent another value.
  - formats_by_post must contain exactly post_count arrays.

  IMPORTANT: An Instagram Story is an add-on, not a separate post. Do NOT count a story as its own post when the deal also includes at least one video deliverable. Examples:
  - 1 Reel + 1 Story → post_count = 1 (story rides on the post)
  - 2 TikToks + 1 Story → post_count = 2
  - 3 Reels + 1 Story → post_count = 3
  - 1 Story only (no video) → post_count = 1 (the story is the post)
  Always include "Instagram Story" in platforms whenever it's part of the deal — counting and platform listing are independent.

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
