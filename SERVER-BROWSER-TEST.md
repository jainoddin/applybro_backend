# Server display access test

This is a one-shot Naukri login-page probe, not an application worker. It uses ordinary headed Chromium on Xvfb, with no stealth changes, stored passwords or imported browser sessions. An Xvfb display belongs to the server, so the user's laptop is not needed for this probe. It does not guarantee Naukri access or prove offline applications work.

On an existing Linux host with Docker:

```sh
docker build -f Dockerfile.browser-test -t applybro-browser-test .
docker run --rm --init --ipc=host -p 127.0.0.1:10000:10000 applybro-browser-test
```

Output meanings:

- `LOGIN_FORM_AVAILABLE`: official login form loaded; no account has been signed in.
- `BLOCKED`: stop. The portal rejected server access; no login/submission is claimed.
- `NOT_VERIFIED`: expected login form was not observed; inspect through an attended server session.

The container starts the health/result host first and runs one bounded browser child. `/health` checks only the host process. `/result` reports the cached browser result. These public endpoints expose no account data or browser control.

A real always-on worker needs suitable hosting, separate per-user server sessions, authentication/OTP handling and verified application outcomes. Existing local Chrome profiles in `secrets/` must never be pushed or baked into an image.

For a temporary free Render Web Service, select `Dockerfile.browser-test` and leave the Docker command empty. The default is `node scripts/server-browser-host.cjs`. It runs exactly one headed access probe through Xvfb at startup, closes the probe browser, and serves the sanitized result. It sleeps according to the free hosting policy and is not an always-on worker. No application environment secrets are needed.

Verified on Render Linux, 2026-11-14 at 13:07:52 UTC:

```json
{"browserMode":"headed","displayAvailable":true,"status":"LOGIN_FORM_AVAILABLE","httpStatus":200,"loginAttempted":false,"applicationsSubmitted":0}
```

Service: https://applybro-browser-access-test.onrender.com/result

This proves only that the login form loaded on that server at that time. It does not verify an account, persist a session, submit a job, or establish continuous offline processing. The earlier `applybro-browser-probe` free service failed port readiness with its custom startup command; it is not the working test endpoint. Both temporary services have auto-deploy disabled.

## Authenticated dynamic login pilot

The frontend `/naukri-test` now reads actual visible Naukri form fields and login/OTP buttons. POST `/login/start`, `/login/refresh`, `/login/fill`, `/login/click`, and `/login/close` require an ApplyBro Firebase bearer verified through the existing backend `/auth/me`. There is no unauthenticated browser-control route. Only official Naukri login/profile navigation is allowed; this relay cannot submit job applications.

Each verified user owns a separate in-memory browser. The free pilot has one concurrent browser slot and a five-minute expiry. Passwords/OTPs are not echoed, logged, sent to an AI planner, or saved to a database. The browser session is temporary and closes on logout from the panel, expiry or service restart. This is not permanent portal pairing. CAPTCHA remains a manual unsupported handoff; it is never solved automatically or treated as sign-in success.

The frontend same-origin backend proxy forwards only the five exact login actions to `NAUKRI_BROWSER_URL` or the verified deployed pilot URL. Configure that variable for an alternate trusted deployment. Credentials must not be sent to an arbitrary browser URL supplied by a user.

Run `node scripts/naukri-login-relay.test.cjs` for synthetic email/password → OTP → protected-profile checks, stale-page rejection, no secret echo, owner isolation, and blocked-page handling. No real credentials or employer submissions are used by those fixtures.

Official headed Linux setup: https://playwright.dev/docs/ci#running-headed
