# Server display access test

This is a one-shot Naukri login-page probe, not an application worker. It uses ordinary headed Chromium on Xvfb, with no stealth changes, stored passwords or imported browser sessions. An Xvfb display belongs to the server, so the user's laptop is not needed for this probe. It does not guarantee Naukri access or prove offline applications work.

On an existing Linux host with Docker:

```sh
docker build -f Dockerfile.browser-test -t applybro-browser-test .
docker run --rm --init --ipc=host applybro-browser-test
```

Output meanings:

- `LOGIN_FORM_AVAILABLE`: official login form loaded; no account has been signed in.
- `BLOCKED`: stop. The portal rejected server access; no login/submission is claimed.
- `NOT_VERIFIED`: expected login form was not observed; inspect through an attended server session.

Exit codes: 0 = login form loaded, 2 = access not verified/blocked, 1 = runtime failure.

Do not deploy this as a restarting production worker: it exits after one probe. A real always-on worker needs suitable hosting, separate per-user server sessions, authentication/OTP handling and verified application outcomes. Existing local Chrome profiles in `secrets/` must never be pushed or baked into an image. No hosting resources are created by this package.

For a temporary free Render Web Service, override the Docker command with `xvfb-run -a node scripts/server-browser-probe.cjs --serve`. This runs exactly one access probe at startup, closes the browser, and serves a sanitized cached result at `/result`; `/health` is a process health check only. It has no browser-control, credentials, screenshots, or application endpoints. It sleeps according to the free hosting policy and is not an always-on worker. No application environment secrets are needed.

Official headed Linux setup: https://playwright.dev/docs/ci#running-headed
