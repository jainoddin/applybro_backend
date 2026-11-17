# LinkedIn private browser login

Open the frontend `/linkedin-test` page while signed into ApplyBro. The login dialog relays visible LinkedIn fields and explicitly chosen login/verification buttons to a separate owner-authenticated browser. HTTP success alone never marks an account connected: protected feed/profile navigation, global navigation and a profile control are required. CAPTCHA/device challenges remain manual. No job application is started by this page.

The frontend proxy uses `LINKEDIN_BROWSER_URL`, falling back to the existing `NAUKRI_BROWSER_URL` helper. The browser helper exposes only authenticated POST `/linkedin-login/start|refresh|fill|click|close` actions. Rebuild/redeploy the browser helper and frontend before using this on the public site; deploying the Nest API alone does not deploy the helper.

Verified state is saved AES-256-GCM encrypted in a separate `secrets/linkedin-sessions` directory. Set private `LINKEDIN_SESSION_KEY` (64 hexadecimal characters), or preserve the existing `NAUKRI_SESSION_KEY` fallback. For a hosted persistent disk set `LINKEDIN_SESSION_DIR` to a private writable directory. Session data is owner-bound and limited to LinkedIn origins/cookies. Login passwords and typed codes are not saved. Closing the dialog retains saved login; Disconnect and forget removes it. LinkedIn can revoke/expire sessions. Local operation requires the helper PC online.

This pilot uses manual refresh after sign-in. It does not connect the browser-companion connection badges, implement LinkedIn job submissions, or enable WhatsApp OTP forwarding for LinkedIn. A blocked or ambiguous page remains unverified. No stealth flags, CAPTCHA bypass or guarantees against account restrictions are included.

Validation: `node --test scripts/linkedin-login.test.cjs` exercises real Chromium against synthetic portal fixtures, not a real LinkedIn account. Test credentials are synthetic. Run the frontend production build for proxy/page type checks.
