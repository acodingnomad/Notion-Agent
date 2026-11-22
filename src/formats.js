export const NOTION_FORMATS = ["9:16", "16:9", "4:5", "Story Set", "raw"];

const VERTICAL_VIDEO_PLATFORMS = new Set([
  "Instagram Reel",
  "TikTok",
  "YouTube Shorts",
]);

function validFormats(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => NOTION_FORMATS.includes(value));
}

export function formatsForPost(deal, postIndex, platforms = []) {
  const formats = new Set(validFormats(deal.formats_by_post?.[postIndex]));

  // These platform-to-format relationships are unambiguous in this database.
  // Ambiguous platforms (UGC, X, LinkedIn) rely on email extraction.
  if (platforms.some((platform) => VERTICAL_VIDEO_PLATFORMS.has(platform))) {
    formats.add("9:16");
  }
  if (platforms.includes("YouTube")) {
    formats.add("16:9");
  }
  if (platforms.includes("Instagram Carousel")) {
    formats.add("4:5");
  }
  if (platforms.includes("Instagram Story")) {
    formats.add("Story Set");
  }

  return NOTION_FORMATS.filter((format) => formats.has(format));
}
