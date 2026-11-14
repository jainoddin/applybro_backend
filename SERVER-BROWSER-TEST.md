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

Official headed Linux setup: https://playwright.dev/docs/ci#running-headed
