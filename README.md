# Big East Conference Rankings (public voting, Vercel + Vercel Blob)

Followers rank all 11 Big East teams 1–11. One submission per X handle, final.
Jack runs the poll from a password-locked Poll Admin tab: open/close, include/exclude
ballots, remove/clear, and a composite-only poster graphic (1600×900 PNG) for X.

## What it is

- **Rank & Submit tab:** voter enters their X handle, drags teams 1–11 (drag grip, or
  up/down buttons), full-width Submit button at the top under the handle card (and a
  second one at the bottom). One submission per handle — the server rejects a second
  submit, and the board locks after submitting. Loading an already-submitted handle
  shows its ranking view-only.
- **Poll Admin tab:** password-locked. Open/close the poll (closed = submit disabled,
  server rejects new submissions; saved rankings untouched). Checklist of every
  submission by @handle with last-updated date and #1 pick; checkbox to include or
  exclude each account (new submissions count by default). Remove individual
  submissions (confirm) and Clear all rankings (confirm). Composite ranking compiled
  live from checked-in accounts only.
- **Composite points (AP-style):** 11 pts for 1st, 10 for 2nd, down to 1 for 11th per
  ballot. Ordered by total points, ties broken by first-place votes, then average rank.
- **Graphic:** composite-only poster, inside Poll Admin only (password-gated; the
  composite data feed also checks the password server-side). On-screen preview +
  downloadable 1600×900 PNG. Every row shows logo, rank, team name, record, points
  in gold, and the first-place-vote count as a separate gold `(N)` element that is
  never truncated — its width is reserved before the name is sized (an earlier
  version clipped `(N)` when the team name was ellipsised on phones).
- **Teams / records:** 2026-27 snapshot as of Nov 23, 2026 in `teams.json`:
  Georgetown 6-0, DePaul 5-0, St. John's 5-0, Seton Hall 5-1, Xavier 5-1,
  Creighton 4-1, Providence 4-1, UConn 4-1, Villanova 4-2, Marquette 4-2,
  Butler 4-3. Logos are ESPN CDN URLs (`a.espncdn.com/i/teamlogos/ncaa/500/<id>.png`,
  all 11 verified loading at 500×500 on Nov 23, 2026); every logo has a text-badge
  fallback (team initials) if it ever fails to load.

## Database (Vercel Blob)

- Blob store: `big-east-rankings-ballots`, private access.
- `meta.json` — `{ open: true, excluded: ["handle", ...] }` (poll open/closed + include/exclude flags).
- `submissions/<handle>.json` — one JSON per submission: `{ handle, order: [11 team ids], updatedAt }`.
- The app uses `@vercel/blob` **v2** (`^2.9.0` in package.json) — v2 is
  required for private stores: its `put`/`get` accept `access: "private"`,
  which must match the store. v1's `put()` rejects private access with
  `access must be "public"` before any network call, and public access
  is rejected by the API on a private store, so v1 cannot write to a
  private store at all. On Vercel the SDK authenticates via OIDC for
  the connected store (v2 supports private writes over OIDC); the
  `BLOB_READ_WRITE_TOKEN` env var (Production, from the store's
  Quickstart → `.env.local` tab) is still set as a fallback for runs
  outside Vercel. Redeploy after adding it.
- The admin password is **never** in the repo. It comes from the `ADMIN_PASSWORD`
  environment variable, checked server-side on every admin/composite request.
  If it is not set, admin endpoints return 503.
- API: `POST /api/submit` (submit a final ranking; `GET /api/submit?handle=@x`
  checks poll state / already-submitted), `GET /api/composite` (password-gated:
  checklist + composite), `POST /api/admin` (password verify, open/close,
  include/exclude, remove, clear all). All use `@vercel/blob` (see `package.json`).

## Files

- `index.html` — the whole app (single page, no build step).
- `teams.json` — the 11 teams, records, ESPN logo URLs.
- `api/_lib.js`, `api/submit.js`, `api/composite.js`, `api/admin.js` — serverless functions.
- `package.json` — `@vercel/blob` dependency (Vercel installs it on deploy).
- `vercel.json` — function timeouts.
- `test/test-rankings.js` — local tests (run `node test/test-rankings.js`).
- `scripts/deploy.py` — optional direct file-upload deploy (see below).

## Deploy — option A: GitHub + Vercel import (recommended)

1. **GitHub — upload the files**
   - Go to https://github.com/new — repository name `big-east-rankings`, **Public**,
     do not add a README.
   - On the new repo page, click **Add file → Upload files** and drag in everything
     from this folder: `index.html`, `teams.json`, `api/`, `package.json`,
     `vercel.json`, `README.md` (the `test/` and `scripts/` folders are fine to
     include too). Commit.
   - On iPhone: download/unzip this folder in the Files app first, then upload
     from Safari the same way.

2. **Vercel — import it**
   - Go to https://vercel.com/new and make sure you are on the **hoyas** team.
   - **Import Git Repository**, pick `big-east-rankings`.
   - Project name: `big-east-rankings`. Framework Preset: **Other** (no framework),
     no build command. Install command stays the default `npm install` — that
     installs `@vercel/blob`. Deploy.

3. **Database — Blob store**
   - In the Vercel dashboard, go to **Storage → Create Store → Blob**.
   - Name: `big-east-rankings-ballots`, private access.
   - Connect it to the `big-east-rankings` project. Then set the token:
     on the store page, Quickstart → `.env.local` tab, copy the
     `BLOB_READ_WRITE_TOKEN` value and add it as a project env var
     (Production) as a fallback. On Vercel the v2 SDK authenticates via
     OIDC for the connected store. Redeploy after adding it.
   - If voting fails afterwards, make sure the store shows as Connected in
     **Project → Settings → Storage** and `BLOB_READ_WRITE_TOKEN` is set
     for Production, then redeploy.

4. **Admin password**
   - **Project → Settings → Environment Variables**, add `ADMIN_PASSWORD`
     (Production) with the password you want for Poll Admin. Redeploy after
     adding it. Without it, Poll Admin stays locked with a 503.

5. **Make it public — do not skip this**
   - **Project → Settings → Deployment Protection → disable it.** New hoyas
     projects inherit SSO Deployment Protection, so without this followers hit
     a Vercel login wall instead of the voting page.

6. **Test it**
   - Open the live Vercel URL, enter an X handle, rank the teams, hit Submit.
     The board should lock and say the ranking is final.
   - Open **Poll Admin**, unlock with your `ADMIN_PASSWORD`, check the
     submission shows in the checklist and the composite, then try the
     Graphic section → Download PNG.

## Deploy — option B: direct file upload (no GitHub)

From this directory: `python3 scripts/deploy.py` — uploads all files with the
Vercel `create_deployment` tool (project `big-east-rankings`, production).
Total payload is well under the ~110 KB argument limit. You still need steps
3–5 above (Blob store, `ADMIN_PASSWORD`, Deployment Protection) in the
Vercel dashboard afterwards.

## Local tests

`node test/test-rankings.js` — points math (11…1, ties by first-place votes),
one-submit-final (second submit rejected, including different handle casing),
include/exclude changing the composite, open/close rejection, and password
gating (wrong password rejected, missing ADMIN_PASSWORD returns 503).
Handlers run against an in-memory fake Blob store; no Vercel account needed.

## Status (2026-11-23)

- Built locally from the current artifact's spec and tested locally (see
  `test/test-rankings.js` output). Not deployed; no GitHub repo or Vercel
  project was created from here.
- The live artifact this mirrors (Muse, private) already has 2 real ballots
  in its own database. This repo is a separate, fresh copy: production here
  starts with zero submissions.
