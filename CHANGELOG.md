# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Web app scaffold: Vite, React 19, TypeScript (strict), Tailwind CSS 4.
- Installable PWA: manifest, app icons and service worker.
- `domain/money.ts`: integer-cent parsing, formatting, summing and proportional allocation, with unit tests.
- ESLint rule keeping `domain/` free of React, Supabase and other app layers.
- GitHub Actions CI: type check, lint, unit tests and build on every pull request.
- npm workspaces at the repository root.

- Project requirements, architecture overview and draft database schema.
- Architecture Decision Records 0001–0007.
- Contribution guidelines, issue templates and pull request template.
