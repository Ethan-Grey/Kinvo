# Security

How Kinvo protects family members' data, what's checked automatically, and what's knowingly left out. Reviewed for v1.0 (M7).

To report a problem, open a [private security advisory](https://github.com/Ethan-Grey/Kinvo/security/advisories/new) rather than a public issue.

## What we're protecting

- **Who owes whom, and how much.** Loans, agreements, payments and track records are private between a lender and a borrower.
- **The agreement record.** What was agreed, and by whom, must be impossible to change quietly.
- **Accounts.** Nobody should be able to act as someone else.

The realistic threats for a family app are: someone outside the family finding the app, a family member seeing loans between other people, a bug that lets a user change data they shouldn't, and someone with a stolen link (an invite or an email). A determined attacker with access to the Supabase or Google accounts themselves is out of scope. Protect those accounts with 2-Step Verification.

## How it's enforced

| Layer | Control | Where |
|---|---|---|
| Sign-in | Google or a one-time email code, no passwords. PKCE for Google. Sessions are managed by Supabase Auth. | ADR-0005 |
| Who can lend | `can_lend` is granted by hand in the SQL Editor. Borrowers join only through a single-use invite. | ADR-0008 |
| Invites | Random 32-byte tokens, stored only as SHA-256 hashes, single use, expire after 7 days, revocable | `create_invite` |
| Reading data | Row Level Security on every table. You see only your own profile, your relationships, and their loans. | all migrations |
| Changing data | No table accepts direct writes. Every change goes through a `SECURITY DEFINER` function that checks who you are, validates the input, and writes an audit event. | ADR-0003 |
| Agreements | Each version of the terms is immutable and fingerprinted. Accepting means sending back the fingerprint you saw. | ADR-0009 |
| History | `audit_events` is append-only. Mistakes are corrected by reversal with a reason, never by editing. | ADR-0010 |
| Money | Integer cents, with balances recalculated from confirmed payments rather than stored | ADR-0007, ADR-0010 |
| Email sender | The `send-notifications` function accepts calls only with the shared secret (constant-time compare). It uses the service role, which never reaches the browser. | ADR-0013 |
| Emails | All names and text are HTML-escaped, and links are restricted to in-app paths. | `_shared/email.ts` |
| Web app | React escapes all output, and there's no `dangerouslySetInnerHTML`. Redirects after sign-in accept in-app paths only (`safeNextPath`). | `apps/web` |
| Browser | Strict Content Security Policy (no inline or third-party scripts; connections only to our Supabase project), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (keeps invite links out of Referer headers) | `apps/web/vercel.json` |
| Images | Receipts and profile photos are re-encoded to fresh JPEGs on the device (metadata and hidden content dropped, non-images refused), stored in private buckets limited to JPEG/WebP and 5 MB / 2 MB, readable only by the people involved, and never overwritable (ADR-0016) | `data/images.ts`, receipts and photos migrations |
| Secrets | None in the repository. They live in Vercel env vars (public keys only), Supabase Edge Function secrets, Supabase Vault and GitHub Actions secrets. | NF-02 |
| Your data | "Download my data" runs with the caller's own permissions, so it can't return more than the app shows. | `export_my_data` |

## Checked automatically

On every pull request:

- **pgTAP** (`supabase/tests/database`): the permission rules for each feature (who can see and do what), plus a schema-wide audit (`08_security_audit.test.sql`) that fails if any table is missing RLS, any role can write to a table directly, signed-out visitors can call a function, a `SECURITY DEFINER` function doesn't pin `search_path`, or the email outbox is reachable by users.
- **`supabase db lint`** at error level.
- **`npm audit`** of production dependencies (fails on high or critical).
- **Dependabot** opens weekly update PRs for npm packages and GitHub Actions.

## Known limitations

- **No app-level rate limiting.** Supabase Auth limits sign-in attempts and emails. The database functions aren't rate limited, but every caller is a signed-in, invited family member, and actions are logged. Duplicate payments within 2 minutes are rejected.
- **Lender access is all-or-nothing** and granted by SQL. That's fine for one or two lenders, but there's no admin screen.
- **No account deletion.** Loan records are shared with the other person, so deleting them would erase evidence they rely on. Ask the project owner if someone needs to be removed.
- **Email is not end-to-end private.** Notification emails contain amounts and names. They're sent over TLS, but they sit in the recipient's mailbox like any other email. Anyone worried about that can switch emails off in Account.
- **The pending invite path is kept in `localStorage`** between requesting a sign-in email and opening it, so the invite still works after the round trip. It's removed as soon as it's used.
- **Legal status of agreements**: see the legal note in the README.
