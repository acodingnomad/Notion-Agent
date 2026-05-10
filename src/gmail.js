import { google } from "googleapis";

export function createGmailClient({ clientId, clientSecret, redirectUri, refreshToken }) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function getLabelId(gmail, labelName) {
  const res = await gmail.users.labels.list({ userId: "me" });
  const label = res.data.labels.find(
    (l) => l.name.toLowerCase() === labelName.toLowerCase()
  );
  if (!label) {
    const names = res.data.labels.map((l) => l.name).sort().join(", ");
    throw new Error(
      `Label "${labelName}" not found in Gmail. Available labels: ${names}`
    );
  }
  return label.id;
}

export async function getEmailsByLabel(gmail, labelId) {
  const res = await gmail.users.messages.list({
    userId: "me",
    labelIds: [labelId],
  });

  const messages = res.data.messages || [];
  const emails = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = full.data.payload.headers;
    const subject = headers.find((h) => h.name === "Subject")?.value || "";
    const from = headers.find((h) => h.name === "From")?.value || "";
    const date = headers.find((h) => h.name === "Date")?.value || "";
    const body = extractBody(full.data.payload);

    emails.push({ id: msg.id, threadId: full.data.threadId, subject, from, date, body });
  }

  return emails;
}

function extractBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, "base64").toString("utf-8");
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, "base64").toString("utf-8");
    }

    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}
