# Firebase Google + GitHub authentication

Implementation is installed; live sign-in needs the owner's Firebase project configuration and provider setup.

## Values needed from the owner

1. Firebase Console > Project settings > Your apps > Web app: copy the public `firebaseConfig` object (apiKey, authDomain, projectId, appId, messagingSenderId, storageBucket).
2. Firebase Console > Project settings > Service accounts > Generate new private key. Save the JSON privately on your computer and provide its file path. Do not paste its contents in chat, add it to Git or put it in a NEXT_PUBLIC variable.
3. Firebase Authentication > Sign-in method: enable Google and choose the support email.
4. Enable GitHub. Create a GitHub OAuth App and enter its client ID / secret directly into the Firebase provider settings. Set its callback URL to the exact handler shown by Firebase, normally `https://PROJECT_ID.firebaseapp.com/__/auth/handler`. Do not share the GitHub client secret in chat.
5. Firebase Authentication > Settings > Authorized domains: add `localhost` and the actual live website hostname. Use the Firebase authDomain from the supplied config, not whichever browser domain happens to be open.

## Local configuration

Frontend `.env.local`: copy the public fields from `.env.example`. Set server-only `BACKEND_API_URL=http://localhost:4000` locally, or the deployed backend URL in production. The browser calls `/api/backend/...` on its current localhost/domain. No client-side localhost URL is used for the auth flow.

Backend `.env`:

```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=C:/private/path/service-account.json
```

The JSON project_id must match FIREBASE_PROJECT_ID. Restart backend/frontend after changing environment values. Existing CORS supports local ports 3000/3001/3002; API calls through the frontend proxy do not depend on browser-to-backend CORS.

To store the credential in the backend `.env` instead of depending on a downloaded file:

```
node scripts/configure-firebase-env.cjs "C:/private/path/new-service-account.json"
```

The installer validates the project and private-key format, then writes `FIREBASE_SERVICE_ACCOUNT_BASE64` to the ignored backend `.env`. It never prints credential contents. Base64 is encoding, not encryption; treat `.env` as a private secret. Raw `FIREBASE_SERVICE_ACCOUNT_JSON` is also supported. Environment credentials take precedence over file paths, and invalid explicit environment credentials fail closed. Restart the backend after importing. A deleted original cannot be reconstructed from a file path or the public web configuration: generate a replacement service-account key in Firebase if no private copy remains.

## Behavior

- Login/Register use Firebase Google/GitHub popup sign-in; no provider password/access token is stored by ApplyBro.
- Backend verifies Firebase ID tokens, including revocation/disabled-account checks, before upserting the verified UID, name, email, photo, provider and email verification state into PostgreSQL.
- Email collisions across distinct Firebase UIDs are rejected, never silently merged. Sign in using the original provider; explicit account-linking UI is separate work.
- `/get-started`, `/dashboard`, `/student-offer` require login. Student submission/status/claim APIs also enforce Firebase verification and database ownership.
- Public pricing remains readable; selecting a plan/claim requires login, then returns to the intended same-origin page. Internal next paths only: external URLs and login loops are rejected.
- Normal login/register defaults to `/dashboard`. An unfinished setup does not redirect the Dashboard away; it shows Complete Setup instead. Explicit protected-action return paths (such as a selected plan or student verification) are preserved.
- Navbar changes to Dashboard / Sign out. Workspace local preview preferences are stored separately per database user; actual job automation and resume analysis remain unimplemented.
- Firebase client sessions persist through refresh; on token refresh, the backend account is resynchronized. Private service-account credentials never enter a frontend bundle.

## Validation

`npm run build` in both apps; `node --test scripts/auth.test.cjs` in backend. Local negative API tests must reject missing tokens. Real Google and GitHub provider sign-in, domain authorization, refresh/logout and database persistence require the supplied live project configuration and an interactive browser test.

Primary references: [Google](https://firebase.google.com/docs/auth/web/google-signin), [GitHub and callback setup](https://firebase.google.com/docs/auth/web/github-auth), [Admin ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

## Plan countdown
On first account synchronization, a missing subscription is created once with FREE_TRIAL and expiry exactly seven days after the database account creation time (first verified login). Existing subscriptions are retained. The unique userId plus empty-upsert-update prevents login retries from restarting a trial. `/auth/me` includes server-derived plan status, expiry, remaining seconds and canUsePlan. The existing trialEnds column represents expiry for both trial and paid periods. Workspace counts down using the server duration and a monotonic timer, refreshing on focus, each minute and at expiry. Expired/inactive plans show Renew / Choose Plan, which opens workspace pricing. This does not create payment, auto-renewal or a paid subscription; payment activation remains separate.
