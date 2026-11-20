# Savings & Expense Dashboard (own login + Supabase database + Vercel)

Login and password creation are built into this app. Supabase is used only as the database.
Passwords are hashed on the server (scrypt) by `api/app.js`, which runs on Vercel.
The web page never holds a database key.

## Files
- `index.html`   the dashboard and the sign-in / create-account screen
- `api/app.js`   server function: register, login, and all data actions
- `supabase.sql` database tables (locked so only the server can read them)
- `package.json`, `.env.example`

## 1. Supabase (database only)
1. Create a project at supabase.com.
2. SQL Editor > New query > paste `supabase.sql` > Run.
3. Project Settings > API: copy the **Project URL** and the **secret / service_role** key.
   This key is private. It goes only into Vercel (step 2), never into index.html.

## 2. Vercel (hosting + the server function)
1. Put this whole folder in a GitHub repository (keep the `api` folder).
2. vercel.com/new > import the repo > Framework Preset "Other" > before deploying, open
   Environment Variables and add:
   - `SUPABASE_URL`  = your Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your secret key
   - `APP_SECRET` = a long random string (run `openssl rand -hex 32`)
3. Deploy. Open your Vercel URL, tap "Create account", and start adding `+2000` / `-500`.

## How it behaves
- Passwords: minimum 8 characters, hashed with a random salt. Sign-in is locked for 15 minutes after 5 wrong attempts.
- Sessions last 30 days on that device. Sign out ends it.
- Data refreshes every 15 seconds and when you return to the tab, so changes from your phone show on your laptop.
- If you open `index.html` straight from your computer (no server), it runs in Local mode: accounts and data stay in that browser only.

## Not included
- Password reset by email (needs an email service such as Resend). For now an admin can delete a user row in Supabase (Table Editor > app_users) so the person can register again.
