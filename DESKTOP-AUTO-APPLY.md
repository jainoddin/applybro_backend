# Desktop browser processing

The user's installed Chrome/Edge extension executes supported forms in that user's browser. The web application alone cannot control another website's tab. This package does not support mobile background processing or processing while the computer/browser is off. No anti-detection modifications, proxy rotation, credential collection or CAPTCHA solving are added.

## Operator setup

1. Deploy the backend and frontend together. Set `COMPANION_AUTO_APPLY_ENABLED=true` on the backend only when enabling desktop processing. Existing database schemas for companion runs, private resumes, selected portals and AgentPreference must already be installed. No schema migration is introduced by this change.
2. Build the extension with `node build.cjs https://applybro-frontend.vercel.app` in `browser-companion`. Package only its runtime JS, manifest, icons and README; never package node_modules or user data.
3. Pause Hosted Agent for the account. Desktop scheduling rejects accounts with hosted processing enabled. Save the resume, accurate candidate facts, selected portals, explicit Auto-Apply consent, daily limit (for example 5) and match threshold in Get Started.
4. Install/reload the v0.4.0 desktop extension. Open `/browser-companion`, pair it, then open/check each portal. Login stays on the official portal. Portal checks are observed browser signals, not official API identity verification. Pairing expires after seven days.
5. Click **Enable / resume on this computer**. This setting persists in extension local storage. Task IDs and application evidence remain in the backend. A five-minute browser alarm checks for work; Chrome may delay alarms when suspended or offline. Discovery is rate limited to once per portal per fifteen minutes.

## Lifecycle

- New browser startup recreates the alarm and asks the backend for safe pending tasks. Old tab IDs are discarded. It does not keep working while powered off, and cannot launch the browser at OS boot.
- Closing an active task tab pauses the batch. Explicit Resume or a fresh browser startup can recover unsubmitted CREATED/OPENED work.
- REVIEW_REQUIRED, LOGIN_REQUIRED and unconfirmed SUBMITTING/UNKNOWN tasks do not automatically replay. Complete or inspect those tasks manually. Already-confirmed jobs cannot submit again.
- Daily limits are enforced by backend submission reservations, including unresolved outcomes and hosted submissions. Five is a cap, not a promise of five eligible jobs. Resume availability does not establish eligibility.
- Only supported success evidence changes the submission count. Unknown questions, challenge screens and unsupported layouts need user input. No WhatsApp delivery is claimed by this change.
- Stop desktop batch also disables the account's saved Auto-Apply mode. It cannot undo an application already accepted by an employer.

## Validation

Backend: `npm run build`, then `node --test scripts/desktop-batch.test.cjs`.
Extension: `npm test`. Fixtures test actual browser DOM interactions and mocked scheduler events; they do not certify acceptance by LinkedIn/Naukri.
Frontend: `npm run build`.

Live acceptance still requires the installed extension, an authenticated paired account and one suitable job. Record the actual job URL and employer confirmation before reporting success. No real application is submitted by the test suite.
