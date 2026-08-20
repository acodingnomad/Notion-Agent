import test from "node:test";
import assert from "node:assert/strict";
import { isIgnoredThread, parseIgnoredThreadIds } from "./ignore.js";

test("parseIgnoredThreadIds trims IDs and ignores empty values", () => {
  assert.deepEqual(
    [...parseIgnoredThreadIds(" thread-1,thread-2, ,")],
    ["thread-1", "thread-2"]
  );
});

test("isIgnoredThread matches by Gmail thread ID", () => {
  const ignored = parseIgnoredThreadIds("thread-1,thread-2");

  assert.equal(isIgnoredThread({ threadId: "thread-1" }, ignored), true);
  assert.equal(isIgnoredThread({ threadId: "thread-3" }, ignored), false);
  assert.equal(isIgnoredThread({ id: "thread-1" }, ignored), false);
});
