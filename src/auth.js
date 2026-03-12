import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import { URL } from "url";
import { exec } from "child_process";

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI } =
  process.env;

if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
  console.error(
    "Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env – fill those in first."
  );
  process.exit(1);
}

const redirectUri = GMAIL_REDIRECT_URI || "http://localhost:3000/oauth2callback";

const oauth2Client = new google.auth.OAuth2(
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  redirectUri
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/gmail.readonly"],
});

const { port } = new URL(redirectUri);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${port}`);

  if (reqUrl.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = reqUrl.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("Missing authorization code.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Done! You can close this tab.</h1>");

    console.log("\n--- Refresh Token ---");
    console.log(tokens.refresh_token);
    console.log("---------------------\n");
    console.log("Paste the token above into your .env file as:");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    res.writeHead(500);
    res.end("Token exchange failed.");
    console.error("Token exchange error:", err.message);
  }

  server.close();
});

server.listen(port, () => {
  console.log(`Listening on port ${port} for OAuth callback...\n`);
  console.log("Opening browser for Google authorization...");
  exec(`open "${authUrl}"`);
});
