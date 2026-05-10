import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { dealExistsInNotion, getExistingBrandEntries } from "./notion.js";

describe("dealExistsInNotion", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a Gmail-ID-only filter (no Name property, no or wrapper)", async () => {
    let capturedBody;
    globalThis.fetch = mock.fn(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ results: [] }) };
    });

    await dealExistsInNotion("fake-key", "fake-db", "msg-123");

    assert.deepStrictEqual(capturedBody.filter, {
      property: "Gmail ID",
      rich_text: { equals: "msg-123" },
    });
    assert.equal(capturedBody.filter.or, undefined);
  });

  it("returns true when results exist", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{}] }),
    }));

    const exists = await dealExistsInNotion("fake-key", "fake-db", "msg-456");
    assert.equal(exists, true);
  });

  it("returns false when no results", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }));

    const exists = await dealExistsInNotion("fake-key", "fake-db", "msg-789");
    assert.equal(exists, false);
  });
});

describe("getExistingBrandEntries", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a compound filter with Name contains and ±90 day Posting Date range", async () => {
    let capturedBody;
    globalThis.fetch = mock.fn(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ results: [] }) };
    });

    await getExistingBrandEntries("fake-key", "fake-db", "Omnisend", "2025-06-15");

    assert.deepStrictEqual(capturedBody.filter, {
      and: [
        { property: "Name", title: { contains: "Omnisend" } },
        { property: "Posting Date", date: { on_or_after: "2025-03-17" } },
        { property: "Posting Date", date: { on_or_before: "2025-09-13" } },
      ],
    });
  });

  it("returns array of {name, contentType} parsed from page properties", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            properties: {
              Name: { title: [{ plain_text: "Omnisend " }, { plain_text: "Script" }] },
              "Type of Content": { select: { name: "SCRIPT" } },
            },
          },
          {
            properties: {
              Name: { title: [{ plain_text: "Omnisend Post" }] },
              "Type of Content": { select: { name: "BRAND POST" } },
            },
          },
        ],
      }),
    }));

    const entries = await getExistingBrandEntries("fake-key", "fake-db", "Omnisend", "2025-06-15");
    assert.deepStrictEqual(entries, [
      { name: "Omnisend Script", contentType: "SCRIPT" },
      { name: "Omnisend Post", contentType: "BRAND POST" },
    ]);
  });

  it("returns empty array when no matching pages", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }));

    const entries = await getExistingBrandEntries("fake-key", "fake-db", "Omnisend", "2025-06-15");
    assert.deepStrictEqual(entries, []);
  });

  it("paginates when has_more is true", async () => {
    let callCount = 0;
    const cursors = [];
    globalThis.fetch = mock.fn(async (url, opts) => {
      callCount++;
      const body = JSON.parse(opts.body);
      cursors.push(body.start_cursor);
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            has_more: true,
            next_cursor: "cursor-2",
            results: [
              {
                properties: {
                  Name: { title: [{ plain_text: "Omnisend Script" }] },
                  "Type of Content": { select: { name: "SCRIPT" } },
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          has_more: false,
          results: [
            {
              properties: {
                Name: { title: [{ plain_text: "Omnisend Post" }] },
                "Type of Content": { select: { name: "BRAND POST" } },
              },
            },
          ],
        }),
      };
    });

    const entries = await getExistingBrandEntries("fake-key", "fake-db", "Omnisend", "2025-06-15");
    assert.equal(callCount, 2);
    assert.deepStrictEqual(cursors, [undefined, "cursor-2"]);
    assert.equal(entries.length, 2);
  });

  it("throws on Notion API error", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid filter" }),
    }));

    await assert.rejects(
      () => getExistingBrandEntries("fake-key", "fake-db", "Omnisend", "2025-06-15"),
      { message: "Notion API error (400): Invalid filter" }
    );
  });
});
