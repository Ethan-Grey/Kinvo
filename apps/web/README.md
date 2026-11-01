# @kinvo/web

The Kinvo Progressive Web App: React 19, TypeScript, Tailwind CSS 4, built with Vite.

## Scripts

Run from the repository root (they forward to this workspace):

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server at http://localhost:5173 |
| `npm run typecheck` | TypeScript in strict mode |
| `npm run lint` | ESLint, including the `domain/` layer boundary rule |
| `npm test` | Vitest unit tests |
| `npm run build` | Production build with service worker and manifest |

## Structure

```text
src/
├── domain/      Pure logic (money, schedules, allocation). No React, no network.
├── data/        Supabase access, one module per feature.      (from M2)
├── features/    Screens and components grouped by feature.    (from M2)
└── shared/      UI primitives, formatting, hooks.             (from M2)
```

ESLint enforces that `domain/` never imports React, Supabase, or other app layers. See [docs/architecture.md](../../docs/architecture.md).

## Notes

- **TypeScript 6.0** is pinned because `typescript-eslint` doesn't support TypeScript 7 yet.
- `vercel.json` sends all non-file routes to `index.html` so client-side routes work on refresh.
