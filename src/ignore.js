export function parseIgnoredThreadIds(value = "") {
  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export function isIgnoredThread(email, ignoredThreadIds) {
  return Boolean(email.threadId && ignoredThreadIds.has(email.threadId));
}
