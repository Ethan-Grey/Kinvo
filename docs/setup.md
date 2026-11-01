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
   - Redirect URLs: `https://kinvo.vercel.app/auth/callback`, `http://localhost:5173/auth/callback`, and `https://*-ethan-greys-projects.vercel.app/auth/callback` for preview deploys (use your Vercel team slug).

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
