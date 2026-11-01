# 0001. Ship as a PWA instead of a native app

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Users are family members on a mix of iPhones and Android phones. The project has no budget. The original idea was to distribute through TestFlight.

TestFlight has three problems here. It needs the paid Apple Developer Program. It only works on iPhone. And external testers go through Beta App Review, which applies App Store rules restricting personal loan apps, including a 36% APR cap and a minimum 60-day repayment term.

## Decision

Build Kinvo as a Progressive Web App. Users open a link and add it to their home screen.

## Consequences

- Free to host and distribute, and works on every platform.
- No app review, and deploys are instant.
- iOS push notifications only work after the user adds the app to their home screen (iOS 16.4+). The app must prompt for this during onboarding.
- Email is the dependable notification channel, with push as a bonus.
- A native wrapper (Capacitor) remains possible later without rewriting the app.

## Alternatives considered

- **Native iOS (SwiftUI) via TestFlight:** cost, iPhone-only, review risk.
- **React Native / Expo:** still needs store or TestFlight distribution for iOS.
