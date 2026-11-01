# Setup

How to run Kinvo locally and configure the hosted services. Every service used has a free tier.

## 1. Local development

Requires Node.js 22+ and Docker (for the local database).

```bash
npm install
npm run db:start                         # local Supabase in Docker; prints URLs and keys
cp .env.example apps/web/.env.local      # then paste the local API URL and publishable key
npm run dev                              # http://localhost:5173
```

Sign in with email. Locally, magic-link emails are caught by Mailpit (the URL is printed by `db:start`), so nothing is actually sent.

Useful commands:

| Command | What it does |
|---|---|
| `npm run db:reset` | Rebuild the local database from migrations and `seed.sql` |
| `npm run db:test` | Run the pgTAP database tests |
| `npm run db:types` | Regenerate `database.types.ts` from the local schema |

## 2. Supabase project

1. At [supabase.com](https://supabase.com), create a project named `kinvo` in the **Sydney** region.
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Authentication → URL Configuration:**
   - Site URL: your production URL, e.g. `https://kinvo.vercel.app`
   - Redirect URLs: `https://kinvo.vercel.app/auth/callback`, `https://kinvo.vercel.app/auth/confirm`, `http://localhost:5173/**`, and `https://*-ethan-greys-projects.vercel.app/**` for preview deploys (use your Vercel team slug).
4. **Authentication → Email Templates:** for both **Confirm signup** and **Magic Link**, set the subject to `Your Kinvo sign-in code` and paste the contents of [`supabase/templates/sign_in.html`](../supabase/templates/sign_in.html). The default templates only contain a link, which can't reach the app when it's installed on an iPhone home screen.
5. **Email delivery (required before inviting anyone):** Supabase's built-in email service only delivers to members of your Supabase team, and only about 2 emails an hour. Anyone else gets "Email address not authorized". Set up custom SMTP under **Authentication → Emails → SMTP Settings**. A free option for a family-sized app is Gmail:
   - Turn on 2-Step Verification for the Google account, then create an **App password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
   - Host `smtp.gmail.com`, port `587`, username = the Gmail address, password = the app password, sender email = the same address, sender name `Kinvo`.
   - Then raise **Authentication → Rate Limits → emails sent per hour** to something like 30.

## 3. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com), create a project, then **APIs & Services → OAuth consent screen**. Choose *External*, app name *Kinvo*, and add your email.
2. **Credentials → Create credentials → OAuth client ID**, type *Web application*.
   - Authorised JavaScript origins: your production URL and `http://localhost:5173`
   - Authorised redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Copy the client ID and secret into Supabase under **Authentication → Sign In / Providers → Google**, and enable it.

## 4. Vercel

Import the repository and set **Root Directory** to `apps/web`. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## 5. Granting lender access

Lender access is granted manually (ADR-0008). After signing in once, run this in the Supabase **SQL Editor**:

```sql
update public.profiles set can_lend = true where email = 'you@example.com';
```
