# Notion Brand Deal Agent

Reads brand-deal emails from Gmail and adds new deals to the **Notion Brand Deal Calendar**.

**What it does:** finds new deals in the Gmail `In progress` label and creates one entry per post/deliverable in Notion, with `Deal Stage` and `Progress Status` both set to `Not started`. Deal progress after that is handled by native Notion automations — this agent only creates the entries.

Runs automatically via GitHub Actions **twice a day: 9 AM and 5 PM PST**. Emails already turned into deals are skipped before the AI step to keep costs low.

---

## Quick command reference

Run these from the project folder (`Brand Deal Agent`) in Terminal.

### Everyday

| What you want | Command |
|---|---|
| Preview new deals (writes nothing) | `npm start -- --dry-run` |
| Run the agent now (adds new deals, live) | `npm start` |
| Run the tests | `npm test` |

### Focus on one deal

Add `--filter="<brand>"` to only process emails whose subject contains that text:

```bash
npm start -- --dry-run --filter="Indeed"
```

### Gmail authorization (only if login expires)

If a run fails with an `invalid_grant` / expired-token error:

```bash
npm run auth
```

Then copy the new refresh token into `.env` as `GMAIL_REFRESH_TOKEN`, and also update the `GMAIL_REFRESH_TOKEN` secret in the GitHub repo (Settings → Secrets and variables → Actions).

### Run on your own Mac on a schedule (optional — GitHub Actions already does this)

```bash
npm run schedule            # keep it running in a terminal (9 AM & 5 PM PST)
npm run schedule:install    # install as a background service (launchd)
npm run schedule:status     # check the background service
npm run schedule:logs       # tail the logs
npm run schedule:uninstall  # remove the background service
```

---

## Running it on GitHub (the automatic schedule)

- The schedule lives in `.github/workflows/check-deals.yml` (2 runs/day: 9 AM & 5 PM PST).
- **Run it manually anytime:** GitHub repo → **Actions** tab → **Check Brand Deals** → **Run workflow**.
- **See what it added:** same Actions tab → click the latest run → open the logs.

---

## How a new deal is created

For each new email in the `In progress` label, the agent uses AI to extract the brand, platforms, rate, posting date, deliverables, and number of posts, then creates one Notion entry per post:

| Property | Value |
|---|---|
| Name | `{Brand}` (or `{Brand} 1`, `{Brand} 2`, … for multi-post deals) |
| Deal Stage | `Not started` |
| Progress Status | `Not started` |
| Platforms | extracted from the email (Story rides on post 1) |
| Price | per-post rate × 0.8 |
| Posting Date | from the email, or ~2 weeks out, spaced a week apart per post |
| Deliverables / Gmail ID | filled in for reference + de-duplication |

Duplicate protection: the exact email is skipped if it was already turned into a deal (`Gmail ID` match), and entries whose name already exists for that brand are not recreated.

---

## Settings you can tweak (`.env`)

| Variable | Meaning | Default |
|---|---|---|
| `GMAIL_LABEL` | Gmail label to watch | `In progress` |

Everything else in `.env` is credentials (Gmail, Anthropic, Notion) — keep them secret. `.env` is gitignored and never committed.
