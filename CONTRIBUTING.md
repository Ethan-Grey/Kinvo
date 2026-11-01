# Contributing

## Workflow

1. Every change starts as a GitHub Issue.
2. Create a branch from `main` named `<type>/<short-description>`, e.g. `feat/loan-requests`, `fix/duplicate-repayments`, `docs/schema-update`.
3. Commit in small, logical steps using [Conventional Commits](#commit-messages).
4. Open a pull request that links the issue (`Closes #12`). Vercel builds a preview.
5. Merge only when CI passes. Use **squash and merge** for single-purpose PRs, or **rebase and merge** when the individual commits tell a useful story.
6. `main` is protected: no direct pushes.

## Commit messages

Format: `<type>(<optional scope>): <summary in imperative mood>`

| Type | Use for |
|---|---|
| `feat` | A new user-facing capability |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `refactor` | Code change that doesn't change behaviour |
| `chore` | Tooling, config, dependencies |
| `ci` | GitHub Actions changes |
| `db` | Database migrations |

Examples:

```text
feat(loans): add counter-offer flow
fix(repayments): reject duplicate submissions within 60 seconds
db: add instalment_status view
test(domain): cover rounding in charge allocation
```

Keep the summary under 72 characters. Use the body to explain *why* when it isn't obvious.

## Releases

Versions follow [Semantic Versioning](https://semver.org/). Each milestone ends with a tagged release and a [CHANGELOG](CHANGELOG.md) entry.

## Data rules

- Never commit real names, amounts or bank details. Seed and test data must be fictional.
- Never commit `.env` files or keys. Use `.env.example` to document required variables.
- Schema changes go in a new migration file. Never edit a migration that has already been merged.
