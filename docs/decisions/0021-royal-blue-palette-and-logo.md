# 0021. Royal blue palette and logo

- **Status:** Accepted (replaces the palette part of ADR-0020)
- **Date:** 2026-11-04

## Context

The owner tried the Camel / Ivory / Molten Lava palette and preferred pure white and black backgrounds, no brown or red-brown, and a strong blue.

## Decision

- **Backgrounds:** pure white in light mode, pure black in dark mode.
- **Light mode:** Royal Blue `#1E3A8A` for buttons, the main card and accent text, with pale blues for panels.
- **Dark mode:** Sky `#93B4FF` with black text, with deep royal blues for panels.
- **Silver** for edges and muted text. Body text is Midnight `#0F1A33`.
- **Red and green** stay for overdue and paid.
- **Logo:** a royal-blue square with a white K and a sky-blue stroke. Rendered from `favicon.svg` into every app icon, including the iPhone Home Screen and Android maskable versions.

## Consequences

- Every text/background pair is checked for WCAG AA (docs/design.md).
- People who installed Kinvo may need to remove it and add it to the Home Screen again to see the new icon. iOS caches Home Screen icons.
