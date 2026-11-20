# Savings & Expenses (v3.1)

Own login (username **or** email), Supabase as the database, hosted on Vercel.
Also works with no server at all: open it and tap **Continue on this device**.

## What's new in v3.1
- **Gold rate tab** (side tab on desktop, bottom tab on phone): 24K/22K/18K price per gram and per 10 g,
  change since yesterday, a trend chart (1M–5Y) with high/low, value of the gold you hold,
  and gold news headlines from the last 7 days. Refreshes hourly.
  - "India estimate" = international spot in rupees + import duty and GST (default 18.45%:
    15% customs duty since 13 May 2026, plus 3% IGST). Editable on the tab. "International spot" = no taxes.
  - Data: `api/gold.js` reads xaus.com (free, no key) and Google News RSS. Vercel caches it for an hour.
    Nothing to configure. Without the server, prices still load directly; news needs the server.
- **Balance fix:** with no salary set, the top card now shows **Balance = saved − spent**
  (e.g. +35,000 and −300 → ₹34,700). With a salary set it shows what is left of the salary.

## What's new in v3
- **Sign in with username or email.** New accounts pick a username; email is optional.
  Existing accounts still sign in with their email and can add a username under Account.
- **Continue on this device (no sign-up).** One tap, data stays in the browser. Later,
  "Sign in or create an account" offers to copy that data into the new account.
- **Default categories:** Dress, Food, Electronics, Petrol, EMI, Other (with matching icons).
- **Entry date follows the month you are viewing**, so logging a missed bill for last
  month keeps you in last month.
- **Recurring bills & EMI.** Add fixed items once; each month a banner offers to log them all.
- **Edit entries** (✎ on any row), plus **search and filter** above the ledger.
- **JSON backup & restore** (Account menu) — salary, budgets, recurring, goal, all entries.
- **Savings goal** with progress bar, and an optional **carry forward unspent money** toggle.
- **Tap-to-pick category chips** and quick amount buttons (+100, +500, +1,000…).
- **Undo** for deleted entries and categories (5-second toast instead of a confirm box).
- **Installable app (PWA)**: Add to Home Screen on Android/iOS; works offline for the shell.

## Upgrading an existing deployment
1. Supabase > SQL Editor > paste the new `supabase.sql` > Run.
   It only adds columns/tables (username, recurring, goal, carry) and keeps your data.
2. Replace the files in your GitHub repo with this folder (keep `api/`, including the new `api/gold.js`), push. Vercel redeploys.
   Environment variables do not change.

## New setup
### 1. Supabase (database only)
1. Create a project at supabase.com.
2. SQL Editor > New query > paste `supabase.sql` > Run.
3. Project Settings > API: copy the **Project URL** and the **secret / service_role** key.
   This key is private. It goes only into Vercel, never into index.html.

### 2. Vercel (hosting + the server function)
1. Put this whole folder in a GitHub repository (keep the `api` folder).
2. vercel.com/new > import the repo > Framework Preset "Other" > Environment Variables:
   - `SUPABASE_URL`  = your Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your secret key
   - `APP_SECRET` = a long random string (`openssl rand -hex 32`)
3. Deploy, open the URL, tap "Create account".

## How it behaves
- Passwords: 8+ characters, hashed with scrypt and a random salt. 5 wrong attempts lock sign-in for 15 minutes.
- Sessions last 30 days on that device.
- Data refreshes every 15 seconds and when you return to the tab.
- Deletes are sent to the server after the 5-second undo window (or immediately if you close the tab).
- Carry forward uses your current salary for earlier months that have at least one entry.
- Opening `index.html` without the server runs in local mode (accounts and data stay in that browser).

## Files
- `index.html` — the app
- `api/app.js` — server: register, login, data actions, restore
- `api/gold.js` — gold prices, history and news (public, cached hourly)
- `supabase.sql` — tables (locked so only the server can read them)
- `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png` — install as an app
- `package.json`, `.env.example`

## Not included
- Password reset by email (needs an email service such as Resend).
