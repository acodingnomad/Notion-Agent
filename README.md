# Notion Brand Deal Agent

Reads brand-deal emails from Gmail and keeps the **Notion Brand Deal Calendar** in sync.

It runs in two phases every time it runs:

1. **Create** — finds new deals in the Gmail `In progress` label and creates the Script / Filming / Draft / Post pages in Notion.
2. **Status sync** — reads recent replies in each `In progress` thread and moves the matching Notion page statuses forward (Due next → Awaiting approval → Done, etc.), including cascades between stages.

Runs automatically via GitHub Actions **8 times a day, every ~90 min from 9 AM to 7 PM PST**.

---

## Quick command reference

Run these from the project folder (`Brand Deal Agent`) in Terminal.

### Everyday

| What you want | Command |
|---|---|
| Preview status changes (writes nothing) | `npm run sync -- --dry-run` |
| Run status sync for real (writes to Notion) | `npm run sync` |
| Run the full agent now: create + sync (live) | `npm start` |
| Preview the full agent (writes nothing) | `npm start -- --dry-run` |
| Run the tests | `npm test` |

### Focus on one deal

Add `--filter="<brand>"` to only process threads whose subject contains that text:

```bash
npm run sync -- --dry-run --filter="Indeed"
npm start -- --dry-run --filter="Atlassian"
```

### Backfill / audit (fills in missing stage pages)

```bash
npm run audit                          # report only, no changes
npm run audit -- --fix --dry-run       # preview what it would create
npm run audit -- --fix                 # create the missing pages
npm run audit -- --month=2026-08 --fix # audit a specific month
```

### Gmail authorization (only if login expires)

If a run fails with an `invalid_grant` / expired-token error:

```bash
npm run auth
```

Then copy the new refresh token into `.env` as `GMAIL_REFRESH_TOKEN`, and also update the `GMAIL_REFRESH_TOKEN` secret in the GitHub repo (Settings → Secrets and variables → Actions).

### Run on your own Mac on a schedule (optional — GitHub Actions already does this)

```bash
npm run schedule            # keep it running in a terminal (9 AM & 2 PM PST)
npm run schedule:install    # install as a background service (launchd)
npm run schedule:status     # check the background service
npm run schedule:logs       # tail the logs
npm run schedule:uninstall  # remove the background service
```

---

## Running it on GitHub (the automatic schedule)

- The schedule lives in `.github/workflows/check-deals.yml` (8 runs/day: 9:00, 10:30, 12:00, 1:30, 3:00, 4:30, 6:00, 7:00 PM PST).
- **Run it manually anytime:** GitHub repo → **Actions** tab → **Check Brand Deals** → **Run workflow**.
- **See what it changed:** same Actions tab → click the latest run → open the logs. Status sync prints each change and the email quote that triggered it.

---

## Settings you can tweak (`.env`)

| Variable | Meaning | Default |
|---|---|---|
| `GMAIL_LABEL` | Gmail label to watch | `In progress` |
| `SYNC_RECENT_DAYS` | Only react to email activity newer than this many days | `3` |

Everything else in `.env` is credentials (Gmail, Anthropic, Notion) — keep them secret. `.env` is gitignored and never committed.

---

## How status sync decides what to change

Who sent the email matters:

- **Agency** = `teresa@` / `patrick@thedriveagency.co`
- **You** = `codingnomadpr@`, `khristinasar@`, `khrissheer@gmail.com`

| Trigger | Result |
|---|---|
| Agency asks for the script | Script → `Due next` |
| You send the script link | Script → `Awaiting approval` |
| Agency approves the script | Script → `Done`, Filming → `Ready to film` |
| You mark Filming `Done` in Notion | Draft → `Ready for editing` |
| You send the draft link | Draft → `Awaiting approval` |
| Agency approves go-live | Draft → `Done`, Post → `Ready to post` |
| You propose a live date | Post keeps `Ready to post`, sets Posting Date |
| You share the posted link | Post → `Done` |

**Manual triggers in Notion** (no email needed — you change a status and the next stage advances on the next run):

| You set in Notion | It triggers |
|---|---|
| Filming Day → `Done` | matching Draft → `Ready for editing` |
| Draft → `Done` | matching Post → `Ready to post` |

Safeguards:

- **Forward-only** — statuses never move backward. Manual states like `Update requested` / `Scheduled` are left alone.
- **Recent activity only** — old thread history is used as context but never re-applied.
- **Post-number aware** — a signal about "Concept 3" / "Video 1" lands on the right page.
- If it ever sets something wrong (e.g. a wrong `Done`), just fix that page manually in Notion.
