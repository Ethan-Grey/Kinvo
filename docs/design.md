# Design

## Palette

| Name | Hex | Used for |
|---|---|---|
| Royal Blue | `#1E3A8A` | Logo; primary buttons, main card and accent text (light) |
| Sky | `#93B4FF` | Logo stripe; primary buttons, main card and accent text (dark) |
| Pale blue | `#DCE6FA` / `#B9CCF4` | Info panels and "needs you" (light) |
| Deep royal | `#172B66` / `#2C4A9A` | Info panels and "needs you" (dark) |
| Silver | `#B3B6B7` | Card edges (lightened, `#DCDEDF`); muted text (dark) |
| Midnight | `#0F1A33` | Body text (light) |

**Backgrounds are pure white (light mode) or pure black (dark mode)** (ADR-0021). No tinted backgrounds. Cards are separated by soft borders, not shading.

**Red and green are kept for meaning, not decoration.** Overdue and errors are red (`#C62828` light, `#FF8A80` dark); paid and success are green.

## Contrast

Every text and background pair meets WCAG AA (4.5:1 for normal text):

| Pair | Light | Dark |
|---|---|---|
| Body text | Midnight on white, 17.3:1 | White on black, 21:1 |
| Primary button | White on Royal Blue, 10.4:1 | Black on Sky, 10.2:1 |
| Accent text | Royal Blue on white, 10.4:1 | Sky on black, 10.2:1 |
| Info panel | Royal Blue on `#DCE6FA`, 8.3:1 | White on `#172B66`, 13.3:1 |
| "Needs you" | Midnight on `#B9CCF4`, 10.7:1 | White on `#2C4A9A`, 8.2:1 |
| Danger badge | White on `#C62828`, 5.6:1 | Black on `#FF8A80`, 9.2:1 |
| Muted text | `#5F6264` on white, 6.1:1 | Silver on black, 10.3:1 |

Combinations that fail, and are never used for text: Sky or Silver on white, and Royal Blue on black.

## Tokens

Defined once in `apps/web/src/index.css` and switched by `data-theme` on `<html>`. Components use only token classes (`bg-brand`, `text-on-brand`, `text-ink-muted`, …), never raw hex values. Each fill token has a matching `on-*` text token, so text on a coloured fill always uses a pair that's been checked.

## Type

- **Bricolage Grotesque** (variable, self-hosted from `@fontsource-variable/bricolage-grotesque`) for headings and money amounts. Its slightly quirky shapes keep a finance app feeling like a family one.
- The phone's own UI font (`system-ui`) for everything else, so reading text looks native and loads instantly.
- Amounts in lists use tabular figures so columns line up.

## The repayment ring

Kinvo's signature element is a ring around each person's avatar that fills as their loans are repaid. It turns red when a payment is overdue. The same ring appears on Home, in the loan list, on People, on a person's page and at the top of each loan, so "how much is paid back" reads the same everywhere. It fills in once when a screen opens. This is the only motion that plays without a tap, and it's switched off for people who prefer reduced motion.

## Layout

- **No top bar.** Each screen starts with its own title (`PageHeader`) and, on detail screens, a back link.
- **Bottom tab bar:** Home, Loans, a raised **+**, Alerts and Account. The + opens a sheet with only the actions that make sense for the person: ask to borrow, offer a loan, record a payment (choosing the loan if there's more than one) and invite someone.
- **One bold surface per screen.** The solid Violet Twilight card is used for the main figure: what's owed on Home, and the total to repay when proposing a loan. Everything else uses outlined cards on the white or black page.
- **Corner radius follows hierarchy:** 24px for cards, 16px for fields, rows and buttons, and full pills for chips and badges.

## Patterns

| Pattern | Where | Why |
|---|---|---|
| Quick-pick chips | Charge (No charge, 10%, 25%, 50%), payment amount (next payment, all of it) | The common answer is one tap instead of typing |
| Segmented pills | Loan filters, payment method, how often | Every option is visible, unlike a dropdown |
| Timeline | Loan schedule | Shows at a glance which payments are done |
| Date tiles | Coming up on Home | The day stands out more than a date string |
| Empty states | Loans, Alerts, People | Say what will appear and what to do next |
| Skeletons | Every screen while loading | The layout doesn't jump when data arrives |

## One action per page

Anything that asks for more than one decision is split into steps, one question each, with a progress bar, "Step 2 of 4", and Back and Continue in the same place every time (`shared/Wizard.tsx`).

| Flow | Steps |
|---|---|
| Ask to borrow or offer a loan | Who with (only if there's a choice), how much, any charge, how it's paid back, check and send |
| Existing debt on an invite | How much they owe now, how it's paid back, check (when lent, what for) |
| Suggest changes | The same steps, filled in with the current terms |
| Record a payment | How much, then how and when |

The loan page shows where things stand in one sentence and one number, then at most one main button (Accept, I've sent the money, Record a payment), one alternative (Suggest changes), and one quiet way out (Decline, Withdraw, Cancel). Each main button opens its own page (`/loans/:id/accept`, `/change`, `/sent`, `/pay`). The full terms, payment history and earlier versions are folded away until wanted.

## Live updates

Screens update by themselves (ADR-0014): a new notification arriving over Supabase Realtime, the app coming back to the foreground, or a pull down from the top of any screen fetches fresh data. The screen updates in place rather than flashing a loading state.
