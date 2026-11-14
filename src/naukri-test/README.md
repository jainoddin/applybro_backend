# Standalone Naukri login diagnostic

Independent of the hosted application agent. Enable only on a trusted test server with `NAUKRI_LOGIN_TEST_ENABLED=true`; disabled by default. Requires Playwright Chromium (or installed Chrome on Windows).

Authenticated endpoints: POST `/naukri-test/start`, `/naukri-test/login`, `/naukri-test/close`. The frontend is `/naukri-test`. Each account owns an isolated, five-minute in-memory browser. At most three browsers run concurrently. Credentials are used only after a visible official login form is observed; no credential or reusable session is saved. OTP/CAPTCHA stops the diagnostic. An editable protected profile is required before reporting sign-in.

Run `npm run build` then `node scripts/naukri-test-smoke.cjs` for synthetic browser tests. These tests do not submit applications. Portal HTTP 403 remains a blocked result; this service does not bypass access controls.
