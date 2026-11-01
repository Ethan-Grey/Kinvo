# Design

## Palette

| Swatch | Name | Hex | Used for |
|---|---|---|---|
| ⬛ | Pitch Black | `#0A0903` | Text in light mode; background in dark mode; text on orange and amber |
| 🟥 | Red | `#FF0000` | Danger and overdue (lightened to `#FF4D3D` for dark-mode text, darkened to `#C40000` for light-mode text) |
| 🟧 | Princeton Orange | `#FF8200` | Primary buttons, progress bars, icon |
| 🟨 | Amber Gold | `#FFC100` | "Needs your attention" badges; accent text in dark mode; icon |
| 🟫 | Vanilla Custard | `#FFEAAE` | Soft highlight panels in light mode; body text in dark mode |

## Contrast rules

The brights are used as **fills**. Text sits on them in Pitch Black (8:1 on orange, 12:1 on amber). Orange, amber and pure red are below the WCAG 4.5:1 minimum for small text on white, so text in light mode uses darker shades of the same hues:

| Token | Light | Dark |
|---|---|---|
| `brand` (fill) | `#FF8200` | `#FF8200` |
| `brand-ink` (accent text) | `#A84600` (5.9:1 on white) | `#FFC100` (12:1) |
| `danger` (text) | `#C40000` (6.3:1) | `#FF4D3D` (5.6:1) |
| `ink` | `#0A0903` | `#FFEAAE` (15:1) |

Green (`positive`) isn't in the palette but stays for "paid" and "success". Using orange or amber for "paid" would clash with their meaning of "needs attention".

## Tokens

Defined once in `apps/web/src/index.css` and switched by `data-theme` on `<html>`. Components only use token classes (`bg-brand`, `text-ink-muted`, …), never raw hex values.
