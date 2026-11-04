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

## 5. Who can invite people

Everyone can (ADR-0019): any account can invite people who owe them. There's nothing to switch on.

## 6. Notification emails

Kinvo emails people about loan events and due dates (ADR-0013). The database queues them; an Edge Function sends them through Gmail every 5 minutes. Until this is set up, notifications still appear in the app and simply wait to be emailed.

1. **Apply the migration** (`npx supabase db push`, or paste `20261102160000_notifications.sql` into the SQL Editor). It turns on the `pg_cron` and `pg_net` extensions itself and creates the schedules. Check under **Integrations → Cron** that `kinvo-queue-reminders` and `kinvo-send-emails` are listed.
2. **Deploy the function:**
   ```bash
   npx supabase functions deploy send-notifications
   ```
   `supabase/config.toml` turns off JWT checks for this function, because it's called by the database and checks its own secret instead.
3. **Make a shared secret.** Any long random string, for example from `openssl rand -hex 32`. It's only used between the database and the function.
4. **Edge Functions → Secrets:** add these yourself (never paste them into a chat, an issue or a commit):
   - `GMAIL_USER`: the Gmail address emails come from
   - `GMAIL_APP_PASSWORD`: an app password for that account (a new one, separate from the one used for sign-in emails, is fine)
   - `APP_URL`: `https://kinvo-rust.vercel.app`
   - `CRON_SECRET`: the shared secret from step 3
5. **Tell the database where to send.** In the **SQL Editor**, replacing the two placeholders:
   ```sql
   select vault.create_secret('https://<your-project-ref>.supabase.co/functions/v1/send-notifications', 'kinvo_send_url');
   select vault.create_secret('<the shared secret from step 3>', 'kinvo_send_key');
   ```
6. **Check it works.** Do something that notifies the other person (for example record a payment), wait up to 5 minutes, and look for the email. To see the queue:
   ```sql
   select kind, title, email_status, email_attempts, email_last_error
   from public.notifications order by created_at desc limit 20;
   ```
   `failed` rows (after 5 attempts) show the last error. A wrong app password shows up as an authentication error.

## 7. Automatic deploys from GitHub

After this one-time setup, merging a pull request that changes `supabase/migrations`, `supabase/functions` or `supabase/config.toml` applies the change to the live project (`.github/workflows/deploy-supabase.yml`). No more pasting SQL.

1. **Tell the CLI which migrations are already applied.** Migrations pasted into the SQL Editor aren't recorded, so without this step the first deploy would try to run them all again (and stop at the first one, changing nothing). In the repository folder on your computer:
   ```bash
   git pull
   npx supabase link --project-ref odyvgnlofdtbaqvopupn
   npx supabase migration list
   ```
   `link` asks for the database password (**Project Settings → Database**; reset it there if you don't have it). `migration list` shows two columns, Local and Remote. Mark every migration you've already run in the SQL Editor as applied, for example:
   ```bash
   npx supabase migration repair --status applied 20261102102500 20261102120000 20261102130000 20261102140000 20261102150000 20261102160000 20261102170000
   ```
   Leave out any you haven't run; the deploy will apply those. Run `migration list` again: everything you've run should now appear in both columns.
2. **Create an access token** at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens), named e.g. `github-deploy`.
3. **Add two repository secrets** in GitHub under **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_ACCESS_TOKEN`: the token from step 2
   - `SUPABASE_DB_PASSWORD`: the database password from step 1
4. **Try it:** **Actions → Deploy Supabase → Run workflow**. The "Show pending migrations" step lists what it's about to apply.

Edge Function secrets (`GMAIL_USER` and so on) and Vault secrets stay where they are; the workflow never touches them.

## 8. Phone notifications

Pop-up notifications on phones and computers use Web Push (ADR-0017). On iPhone they need iOS 16.4 or later, with Kinvo added to the Home Screen. Until this is set up, the "Notify this phone" card in Account says so and nothing else changes.

1. **Make a key pair**, once, on your computer:
   ```bash
   npx web-push generate-vapid-keys
   ```
   It prints a **Public Key** and a **Private Key**. The private key is a secret: don't commit it or paste it into chats or issues.
2. **Supabase → Edge Functions → Secrets**, add:
   - `VAPID_PUBLIC_KEY`: the public key
   - `VAPID_PRIVATE_KEY`: the private key
   - `VAPID_SUBJECT`: `mailto:` followed by your email, e.g. `mailto:you@gmail.com`. Push services use it to contact you if something goes wrong.
3. **Vercel → Project → Settings → Environment Variables**, add `VITE_VAPID_PUBLIC_KEY` with the **public** key only, then redeploy.
4. **On each phone:** open Kinvo from the Home Screen, go to **Account → Notify this phone → Turn on notifications**, and allow. Home also shows a one-off card offering the same.

Notifications are sent the moment something happens: a database trigger wakes the sender, with the 5-minute schedule as a fallback. If a phone turns notifications off or Kinvo is removed, the push service reports it and Kinvo forgets that device.
