# 0016. Receipts for every payment, profile photos, and confirmed names

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

A payment record is only as good as the trust behind it. People already screenshot or copy their bank's statement image when they pay (Co-operative Bank lets you copy it). Asking for that image every time gives both people the same proof.

Profile photos make the app feel personal, but letting people upload images is a classic way to smuggle in content: hidden metadata, location data, files that only pretend to be images, or polyglot files that are both an image and something else.

People who sign in with an email code start out named after their email address ("bobby99"), which isn't what family should see.

## Decision

**Receipts are required** whenever money moves: when the lender confirms they've sent the loan, when the lender records a payment, and when the borrower says they've paid. The database enforces it: `record_repayment` and `confirm_funds_sent` reject a missing receipt, a path outside the loan's folder, or a file that was never uploaded. The app's receipt step offers **Choose photo** (camera roll or files) and **Paste** (an image copied from a banking app), and pasting anywhere on the page works too.

**Images are cleaned on the phone before upload.** Every image is decoded and redrawn onto a canvas, then saved as a new JPEG (`data/images.ts`). Only pixels survive: EXIF and location metadata, embedded thumbnails, trailing data and anything else hidden in the original file are gone. A file that isn't really an image fails to decode and is refused. Sizes are capped before decoding (25 MB, 50 megapixels), and output is limited to 2000 px for receipts and a 512 px square for photos.

**Storage is private and narrow.**
- Two private buckets: `receipts` (5 MB) and `avatars` (2 MB). Each only accepts `image/jpeg` or `image/webp`.
- Receipts live at `<loan id>/<random id>.jpg`. Only the two people on the loan can upload or view them.
- Photos live at `<user id>/<random id>.jpg`. Only the owner can upload, and only they and the people they lend to or borrow from can view.
- Nobody can overwrite or delete a file. Paths are random, and the database checks their exact shape.
- Images are only ever shown through `<img>`, from `blob:` URLs, with `X-Content-Type-Options: nosniff` and a CSP that allows no scripts from anywhere but the app.

**Names are confirmed once.** Until someone confirms their real name, the app shows only "What's your name?" (with an optional photo). A name from Google counts as confirmed. Names must be 2–80 characters, and can't contain `@`.

## Consequences

- Every payment and every loan has proof both people can open.
- Re-encoding is done by the browser. A modified app could skip it and upload arbitrary bytes labelled as JPEG, up to the bucket limits. Such a file can't run: it only ever loads into an `<img>` (where it fails to display) inside the uploader's own loan or profile folder. Server-side re-encoding would close that gap, at the cost of an image library in an Edge Function.
- Abandoned uploads (someone adds a receipt and then leaves) stay in the bucket. They're small and private, and can be cleaned up later by comparing against recorded paths.
- Payments recorded before this change have no receipt; the app only shows "View receipt" when there is one.

## Alternatives considered

- **Optional receipts:** less friction, but proof would be missing exactly when it's needed.
- **Public buckets with unguessable URLs:** simpler, but links could leak, and nobody would be checking who's looking.
