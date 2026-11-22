import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatsForPost } from "./formats.js";

describe("formatsForPost", () => {
  it("infers vertical, horizontal, carousel, and story formats from platforms", () => {
    assert.deepStrictEqual(
      formatsForPost({}, 0, [
        "Instagram Reel",
        "YouTube",
        "Instagram Carousel",
        "Instagram Story",
      ]),
      ["9:16", "16:9", "4:5", "Story Set"]
    );
  });

  it("preserves an explicitly extracted raw-footage requirement", () => {
    const deal = { formats_by_post: [["9:16", "raw"]] };
    assert.deepStrictEqual(
      formatsForPost(deal, 0, ["UGC"]),
      ["9:16", "raw"]
    );
  });

  it("uses the formats for the matching post only", () => {
    const deal = {
      formats_by_post: [["9:16"], ["16:9"], ["raw"]],
    };

    assert.deepStrictEqual(formatsForPost(deal, 0), ["9:16"]);
    assert.deepStrictEqual(formatsForPost(deal, 1), ["16:9"]);
    assert.deepStrictEqual(formatsForPost(deal, 2), ["raw"]);
  });

  it("drops unsupported values instead of creating new Notion options", () => {
    const deal = { formats_by_post: [["square", "9:16", "vertical"]] };
    assert.deepStrictEqual(formatsForPost(deal, 0), ["9:16"]);
  });

  it("does not guess a format for ambiguous platforms", () => {
    assert.deepStrictEqual(
      formatsForPost({}, 0, ["UGC", "X", "LinkedIn"]),
      []
    );
  });
});
