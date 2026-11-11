# Kinvo: handoff notes for Claude Code

Kinvo is a personal "who owes who" tracker PWA for family, partners and flatmates in New Zealand. It covers loans, split bills, repeating debts, households (shared account, bills, settle up), and a personal "My money" budget.

- Live: https://kinvo-rust.vercel.app
- Repo: https://github.com/Ethan-Grey/Kinvo
- Supabase project ref: `odyvgnlofdtbaqvopupn`
- Owner: G (Ethan Grey). Wants short, blunt answers and minimal, low-clutter UI.

## Stack

- **Web** (`apps/web`): React 19, TypeScript, Vite, Tailwind CSS 4, React Router. Tests use Vitest, Testing Library and axe.
- **Backend** (`supabase/`): Postgres with RLS. Every write goes through `SECURITY DEFINER` functions with `set search_path = ''`, and errors are raised as message keys (e.g. `loan_reason_required`). Edge Function `send-notifications`. pg_cron jobs:
  - `kinvo-queue-reminders` at :05
  - `kinvo-repeating-debts` at :02
  - `kinvo-households` at :03
- **Hosting:** Vercel deploys the web app on merge to `main`. `.github/workflows/deploy-supabase.yml` applies new migrations and Edge Functions on merge to `main`, using the repo secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.
- **CI** (`.github/workflows/ci.yml`): four checks must pass: Web app checks, Database tests (pgTAP), Edge Function checks, Vercel Preview Comments.

## Layout

```
apps/web/src/
  domain/        pure logic: money (integer cents), dates (Pacific/Auckland), split, moneyPlan, household, reschedule
  data/          Supabase calls (loans.ts, repayments.ts, households.ts, myMoney.ts, bills.ts, repeating.ts, reminders.ts,
                 sessionStorage.ts, errors.ts = message-key -> text, database.types.ts = generated types)
  shared/        ui.tsx (Button, ButtonLink, Card, Notice, PageHeader, TextField...), Wizard.tsx (WizardStep, MoneyField,
                 QuickPicks), ActionBar.tsx (ActionBar fixed above the tab bar, ChoiceSheet bottom sheet), icons, useAsync
  features/      loans, repayments, people, households, money, bills, repeating, notifications, dashboard, shell, auth, account, invites
supabase/
  migrations/    timestamped SQL; the latest is 20261110010000_set_loan_reason.sql
  tests/database pgTAP files 01–20; plan(n) must equal the number of tests
  functions/     Edge Functions (Deno)
docs/            architecture, database-schema, design, security, setup, decisions/ (ADRs 0001–0026)
```

## How to make a change

1. Branch off `main` (`feat/...`, `fix/...`, `refactor/...`). Never commit directly to `main`.
2. For database changes, add a new migration `supabase/migrations/<YYYYMMDDHHMMSS>_name.sql` (never edit old ones) and a pgTAP test. Add new RPC signatures to `apps/web/src/data/database.types.ts` by hand, or run `npm run db:types` with local Supabase. Add any new error keys to `data/errors.ts`.
3. Add an ADR in `docs/decisions/` (next is 0027) for anything behavioural, and a `CHANGELOG.md` entry under **Unreleased**.
4. Run the checks from `apps/web`:
   ```
   npx tsc -b && npx eslint src && npx vitest run
   npx prettier --single-quote --no-semi --print-width 120 --write <changed files only>
   ```
   Database tests: `npm run db:start` then `npm run db:test` (needs Docker and the Supabase CLI).
5. Open a PR, wait for the four checks to go green, then G merges. Merging deploys the web app and the database automatically.

## Conventions and gotchas

- Money is integer cents. The `Cents` type is non-negative; signed balances use plain numbers and `formatSignedCents`.
- Dates are NZ local (`todayInNZ`, `Pacific/Auckland`).
- Lint forbids non-null assertions and exporting non-components from component files (react-refresh). Put helpers in `data/` or `domain/`.
- Use sr-only spans for accessible button names, and regex matches for them in tests.
- Every new screen is checked with axe in light and dark mode.
- A production build needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, or it shows "Kinvo isn't set up yet".
- Never ask for, paste or enter secrets (passwords, service keys) in chat. G enters them himself.
- Don't generate images. Recolouring G's own logo SVG is fine.

## Design rules (G's preferences)

- Backgrounds are pure white (light) and pure black (dark).
- Palette is royal blue: `#1E3A8A` in light mode, sky `#93B4FF` in dark mode, silver lines, midnight `#0F1A33` text. No brown or red accents.
- Neutral "Owed / owes you / you owe" wording. Requests say "Ask for money", never "I owe someone".
- Minimal and low cognitive load:
  - At most two main buttons, fixed to the bottom (`ActionBar`).
  - A request has **Accept** and **Decline**; Decline opens a `ChoiceSheet` offering "Make changes" or "Remove this request". Active loans have a main action plus **More** (change dates, forgive the rest, remove).
  - No legal fine print, fingerprints or "full terms" sections.
  - The loan's reason is a line under the title (`ReasonLine`, editable), never its own card.
  - Paying is one screen: amount and receipt. It's recorded as a bank transfer dated today, and the receipt is required.
- Show G a preview before changing the palette or overall look.

## History (PRs, newest first)

- **#57** One-screen payments; editable reason (`set_loan_reason`); offers ask for an optional reason.
- **#53** Anchored ActionBar; Accept/Decline with a follow-up sheet everywhere.
- **#52** Declutter: amount-first requests, simpler accept and paid-out pages, removed full terms, history and fingerprints.
- **#51** A reason is required when asking to borrow.
- **#50** My money: personal bills, pay day, "safe to spend until pay day".
- **#49** Stay signed in on iPhone (IndexedDB session mirror; email code in the installed app).
- **#48** Household spending quick add (`/spend`, used by iPhone Back Tap) and monthly overview.
- **#47** Households: shared account, top-ups, bills with 4 payment methods, tab and settle up, invites.
- **#46** Royal blue palette and logo. **#45** split bills and repeating debts.
- **#44** Anyone can be owed; multiple reminder times. **#43** Lender reschedule and custom reminders.
- **#42** Fixed deleting a user who had accepted an invite.

Open: Dependabot PRs #54–56. #55 (supabase CLI 3.0) may need workflow changes, so check CI before merging.

## Next up (discussed, not built)

Overdue payments: loans drift as they get extended again and again instead of being paid. The recommended first build:

1. **Payday-aligned due dates.** Ask the borrower's pay cycle and day, and schedule payments on it.
2. **Borrower "I can't pay this one".** Shown a few days before the due date. Options: pay part now, move it to next payday, or add it to the end. The lender approves with one tap.
3. **Extension counter on the loan page.** For example, "Extended 3 times · 41 days behind the original plan".

Later ideas:

- Missed amounts carry forward automatically.
- Late, Behind and Stalled stages, with a "Needs attention" section on Home.
- Reminders that build up, plus a one-tap Nudge.
- A private on-time record for each person.
- A settle offer ("pay $X and we're square").
- An agreed pause that restarts by itself.
- Skip late fees.
