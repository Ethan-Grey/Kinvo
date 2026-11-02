# Design

## Palette

| Name | Hex | Used for |
|---|---|---|
| Frozen Lake | `#97DFFC` | Info panels and progress track (light); accent text (dark); icon |
| Soft Periwinkle | `#858AE3` | "Needs you" panel and badges; icon |
| Violet Twilight | `#613DC1` | Primary buttons, selected states |
| Indigo | `#4E148C` | Accent text and progress fill (light); info panels (dark) |
| Dark Amethyst | `#2C0735` | Body text (light); text on Frozen Lake and Periwinkle; icon background |

**Backgrounds are pure white (light mode) or pure black (dark mode).** No tinted or translucent backgrounds anywhere. Cards are separated by neutral grey borders (`#E4E4E7` / `#2A2A2A`), not shading.

**Red and green are kept for meaning, not decoration.** Overdue and errors are red, paid and success are green. They aren't in the palette, but people read them instantly, and purple can't do that job.

## Contrast

Every text and background pair meets WCAG AA (4.5:1 for normal text):

| Pair | Light | Dark |
|---|---|---|
| Body text | Dark Amethyst on white, 17.7:1 | White on black, 21:1 |
| Primary button | White on Violet Twilight, 7.1:1 | same |
| Accent text | Indigo on white, 11.7:1 | Frozen Lake on black, 14.3:1 |
| Info panel | Dark Amethyst on Frozen Lake, 12:1 | White on Indigo, 11.7:1 |
| "Needs you" | Dark Amethyst on Periwinkle, 5.7:1 | Black on Periwinkle, 6.7:1 |
| Danger badge | White on `#C40000`, 6.3:1 | Black on `#FF6B6B`, 7.6:1 |
| Muted text | `#5C5C5C` on white, 6.7:1 | `#A3A3A3` on black, 8.3:1 |

Combinations that fail, and are never used: Frozen Lake or Periwinkle on white (1.5:1, 3.1:1), and Indigo or Violet on black (1.8:1, 3:1).

## Tokens

Defined once in `apps/web/src/index.css` and switched by `data-theme` on `<html>`. Components use only token classes (`bg-brand`, `text-on-brand`, `text-ink-muted`, …), never raw hex values. Each fill token has a matching `on-*` text token, so text on a coloured fill always uses a pair that's been checked.
