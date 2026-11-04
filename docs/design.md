# Design

## Palette

| Name | Hex | Used for |
|---|---|---|
| Camel | `#AF9164` | "Needs you" panels; primary buttons and accent text (dark); avatars |
| Ivory Mist | `#F7F3E3` | Background (light); body text (dark); text on Molten Lava |
| Silver | `#B3B6B7` | Card edges (softened); muted text (dark); avatars |
| Molten Lava | `#6F1A07` | Primary buttons, accent text and progress (light); info panels (dark) |
| Dark Coffee | `#2B2118` | Body text (light); background (dark); text on Camel |

Light mode is Ivory Mist with Dark Coffee text; dark mode is Dark Coffee with Ivory Mist text (ADR-0020, replacing the earlier pure white and black). Cards are separated by soft borders, not shading.

**Red and green are kept for meaning, not decoration.** Overdue and errors are a brighter red than Molten Lava (`#B3261E` light, `#F4A097` dark) so the two aren't confused; paid and success are green.

## Contrast

Every text and background pair meets WCAG AA (4.5:1 for normal text):

| Pair | Light | Dark |
|---|---|---|
| Body text | Dark Coffee on Ivory, 14.2:1 | Ivory on Dark Coffee, 14.2:1 |
| Primary button | Ivory on Molten Lava, 10.3:1 | Dark Coffee on Camel, 5.3:1 |
| Accent text | Molten Lava on Ivory, 10.3:1 | Camel on Dark Coffee, 5.3:1 |
| Info panel | Dark Coffee on `#D7C7AA`, 9.5:1 | Ivory on Molten Lava, 10.3:1 |
| "Needs you" | Dark Coffee on Camel, 5.3:1 | same |
| Danger badge | White on `#B3261E`, 6.5:1 | Dark Coffee on `#F4A097`, 7.7:1 |
| Muted text | `#6B5E51` on Ivory, 5.7:1 | Silver on Dark Coffee, 7.7:1 |

Combinations that fail, and are never used for text: Camel or Silver on Ivory (2.7:1, 1.8:1), and Molten Lava on Dark Coffee.

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
