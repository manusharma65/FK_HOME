# FK Home — Disaster Recovery

If Railway is down and you need to get FK Home running again somewhere else.

Read this when calm. Use it when panicked.

---

## What FK Home depends on

1. **Code** — on GitHub: `https://github.com/<your-org>/campaignpulse-setup` (branch `fk-one-staging` is current).
2. **Database** — Postgres on Railway. Contains everything, **including uploaded profile files** (stored as bytea inside the database from r0.9 onwards).
3. **Backups** — daily off-site copy at Backblaze B2, bucket `fkhome`. Captures the bytea content too — one pg_dump restores the whole thing including all employee files.
4. **Domain** — `app.fksports.co.uk`, registered at GoDaddy.
5. **Environment variables** — set on Railway. Keep a copy somewhere safe (password manager).

If any single one of those five is intact, you can recover. If all five are gone — you're rebuilding from scratch and you need new credentials for everything.

---

## Scenario A — Railway is down for a few hours

**Do nothing.** Wait. Status updates: <https://status.railway.com>. FK Home will come back when Railway does.

Tell the team: attendance for the day can be logged manually on paper, entered later.

---

## Scenario B — Railway is permanently lost (account suspended, data deleted, etc.)

You need to redeploy FK Home on a different host using your most recent B2 backup.

### Step 1 — Get the latest backup file

Log into Backblaze: <https://secure.backblaze.com/b2_buckets.htm>

- Open bucket `fkhome`.
- Sort by date, find the most recent `fkhome-YYYY-MM-DD-HHmmss.dump`.
- Click Download. Save it somewhere safe on your Mac, e.g. `~/Downloads/fkhome-latest.dump`.

If you can't get to Backblaze for some reason, you can also download backups from FK Home itself while it's still up (Admin → Backups → "Download latest"). Do this as a precaution if Railway looks shaky but isn't dead yet.

### Step 2 — Spin up a new host

Pick one of these. They all work, in rough order of simplicity:

- **Render** (recommended, similar to Railway): <https://render.com>
- **Fly.io**
- **DigitalOcean App Platform**

Steps for Render (others are similar):

1. Sign up, add billing card.
2. Click **New +** → **PostgreSQL**. Pick the cheapest plan (you can scale up later). Region: Frankfurt or London. Name it `fkhome-postgres`. Create.
3. Copy the **External Database URL** it gives you — looks like `postgres://user:pass@host:5432/dbname`. Keep this safe.
4. Click **New +** → **Web Service**. Connect your GitHub. Pick the repo. Branch: `main` (or whichever was production).
5. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. Environment Variables — add these (values from your password manager / old Railway):
   - `DATABASE_URL` = the External Database URL from step 3
   - `B2_ENDPOINT` = `s3.eu-central-003.backblazeb2.com`
   - `B2_BUCKET` = `fkhome`
   - `B2_KEY_ID` = (from password manager)
   - `B2_APP_KEY` = (from password manager)
   - `PORT` = `8080`
7. Create Web Service. Wait for first deploy.
8. Visit `/healthz` on the new URL — should return `version: "r0.x"`.

### Step 3 — Restore the database

The new database is empty. Restore the dump.

On your Mac:

```bash
# Make sure pg_restore is installed:
brew install postgresql@16

# Restore (replace DATABASE_URL with the one from step 2.3 above):
pg_restore --clean --no-owner --no-privileges \
  --dbname="postgres://user:pass@host:5432/dbname" \
  ~/Downloads/fkhome-latest.dump
```

Expect a few warnings about "role does not exist" — they're harmless because we dumped with `--no-owner`.

Verify by visiting the new web service URL and logging in with your old credentials. All users, attendance, leaves should be there as of the backup time.

### Step 4 — Point the domain to the new host

1. Log into GoDaddy: <https://godaddy.com>
2. My Products → Domains → `fksports.co.uk` → DNS.
3. Find the `A` or `CNAME` record for `app` (the one that maps `app.fksports.co.uk`).
4. Change its target to the new host's domain (e.g. `fkhome.onrender.com`).
5. Save. DNS propagation takes anywhere from 1 minute to 24 hours.

While DNS propagates, the team can use the temporary Render URL.

### Step 5 — Smoke test before declaring done

- [ ] `/healthz` returns the expected version
- [ ] You can log in as Bobby
- [ ] Admin → Users shows all users
- [ ] Admin → Backups tab loads (run a fresh manual backup to confirm B2 wiring works on new host)
- [ ] Aryan (or anyone) can log in and see their attendance for today
- [ ] Today's leaves card shows the right balance
- [ ] DNS has propagated — `app.fksports.co.uk` now reaches the new host

### Step 6 — Tell the team

Short message in WhatsApp/Slack: "FK Home is back. If anything looks wrong, message Bobby."

---

## Scenario C — Database corrupted but Railway is fine (you ran a bad migration, accidentally wiped data)

You don't need to move hosts. Just restore the data into the existing Railway Postgres.

1. Download the most recent good backup from Backblaze (see Scenario B, Step 1).
2. On your Mac:

```bash
# Get the Railway DATABASE_URL — from Railway → Postgres service → Variables → DATABASE_URL
pg_restore --clean --no-owner --no-privileges \
  --dbname="<the railway DATABASE_URL>" \
  ~/Downloads/fkhome-latest.dump
```

3. Redeploy the Node service (Railway should pick up the changed DB state on next request; if anything seems off, hit Restart in Railway).
4. Verify on `app.fksports.co.uk`.

---

## What to do RIGHT NOW (before anything happens)

If you haven't done these once, do them now:

- [ ] Make sure 2FA is on for: Railway, Backblaze, GoDaddy, GitHub, `bobby@fksports.co.uk` Google account.
- [ ] Save all of these in a password manager (1Password recommended):
  - Railway login + recovery codes
  - Backblaze login + recovery codes + application key (keyID + appKey)
  - GoDaddy login + recovery codes
  - GitHub login + recovery codes
  - The four B2 env var values from Railway (`B2_BUCKET`, `B2_ENDPOINT`, `B2_KEY_ID`, `B2_APP_KEY`)
- [ ] Print this document. Put a paper copy somewhere physically safe (so you have it even if your laptop is the failure).
- [ ] Once a quarter, open Backblaze and download the most recent backup, just to confirm you still have access. Don't restore it — just confirm download works.

---

## One-time B2 setup (already done for r0.8, kept here for reference)

The B2 bucket should have a Lifecycle Rule that auto-deletes backups older than 30 days. To check:

1. Backblaze → Buckets → `fkhome` → Lifecycle Settings.
2. Should show: "Keep prior versions for this many days: 30" or similar.
3. If not set, click "Use a lifecycle rule" → choose "Keep only the last version of the file" with 30-day prior-version retention.

This keeps the bucket small and the bill predictable. The most recent 30 days of nightly backups always exist; anything older is deleted automatically.

---

## Questions that will come up

**"Can we run FK Home on the local Mac in an emergency?"**
Yes, in theory — `npm install && npm start` with a local Postgres. But you'd be the only one who can use it. Useful for recovering data offline, not for running the business.

**"How long does the rebuild take?"**
First time: 2–3 hours if everything goes smoothly. With practice: under 60 minutes. Most of it is waiting for DNS and the first deploy.

**"What if Backblaze is also down?"**
Wait. Backblaze has uptime SLAs comparable to AWS. A simultaneous Railway + Backblaze outage is so unlikely we don't plan for it. If you want to plan for it, set up a weekly second backup destination on your Mac via the Backblaze web UI — pure manual download.

**"What if I die?"**
Satyam should know this document exists. Consider giving him a sealed envelope with your 1Password Emergency Kit and a note: "Open only if Bobby cannot be reached." That keeps FK Sports recoverable without putting credentials in someone's hands by default.
