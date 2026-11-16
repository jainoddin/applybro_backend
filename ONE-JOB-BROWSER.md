# Single application in the existing private Naukri browser

The `/naukri-test` page now has a one-job action after a verified login. It reuses that exact browser context, not a local Chrome account and not a new login. An incomplete Naukri homepage with Complete profile, My home and recommended jobs is recognized as signed in.

Profile navigation labels may be rendered as div/span controls. Detection checks their exact visible labels as well as the protected route, recommendations/profile markers and absence of a password form. An HTTP 200 alone still never establishes a connection. Once verified, the existing browser gets a bounded 30-minute window so it does not close while preparing the application.

The authenticated API reads the current user's immutable saved resume bytes and raw saved profile fields from `/profile/browser-material`. It does not use UI defaults for salary, notice period or work rights, and does not infer unknown answers from a name or job description. Review your saved candidate details before starting.

The default UI requires no job URL, title or company. After authorization it uploads the saved file, requires a fresh portal receipt, searches live listings using saved target roles/location/experience, and inspects a bounded set of current job pages. It selects only a native-Apply listing with matching role, location, a verified experience lower bound, sufficient keyword coverage and supported primary technologies. Previously observed candidates, if supplied by a trusted server/operator source, are also revalidated live. Unknown experience requirements, unsupported external forms, and already-applied jobs are skipped. The existing manual-job API remains available for an explicitly chosen listing.

The existing vision planner receives a masked screenshot, visible controls and saved facts. It selects one action at a time; the executor validates it against the current DOM, fills only supported fact bindings, and observes again. Unknown questions pause for owner input. No CAPTCHA, account restrictions or login protections are bypassed. Closing the progress dialog preserves an active background task; Stop task halts it. Reopening restores the existing task instead of creating another browser or duplicate application.

Before a submission, the executor checks job/company identity, required fields, verification challenges and the confirmed resume upload. It reserves one submission attempt. Only a subsequent portal receipt reports CONFIRMED. Uncertain results report UNKNOWN and are never automatically retried. Stop also blocks a pending model response from causing a later submit. Activity, masked screenshots and the result are visible in the dialog.

## Deployment

Build/deploy the main backend, frontend, and the existing browser service with `Dockerfile.browser-test`. The image compiles only `agent-policy.ts` for its shared executor; it does not start another Nest API. Preserve existing browser transport and authentication settings. Add `CLOUD_AGENT_MODEL` and `CLOUD_AGENT_API_KEY` (or `GEMINI_API_KEYS`) privately to the browser service. Enable `www.naukri.com` in `CLOUD_AGENT_ALLOWED_HOSTS` for recognized navigation links. No secrets belong in Git or in browser code.

The Next proxy forwards only the exact authenticated `job-start`, `job-status`, `job-answer` and `job-stop` operations. Candidate material is fetched directly between servers with the requesting user's authorization and no-store responses. It is never loaded from another user's browser. One attempt per session; status polling never runs an action.

## Limits

### Local browser fallback

When a cloud login request fails, the same UI can use a private helper on this PC: run `server-browser-host.cjs` with `PORT=4014`, `NAUKRI_MINIMIZE_WINDOW=true` and `CLOUD_AGENT_CHROME_PATH` pointing at installed Chrome. Load the backend `.env` using Node's `--env-file=.env`, without printing it. Start the frontend with `NAUKRI_BROWSER_URL=http://127.0.0.1:4014`, `BACKEND_API_URL=https://applybro-backend.onrender.com`, and `NODE_OPTIONS=--dns-result-order=ipv4first`, using port 3012. Visit `http://localhost:3012/naukri-test` and authenticate as yourself. This opens a fresh isolated Chrome context, never imports another local account's cookies, and minimizes its window before loading Naukri. The laptop and both processes must remain running. Cloud HTTP 200/page access is not evidence of a successful login.

Login status polling reuses a timestamped, masked preview while requests are pending, instead of repeatedly capturing full screenshots on the small cloud CPU. This reduces avoidable load; it is not proof that a portal transport failure or restriction is fixed.

This is a bounded, in-memory, 30-minute single-job pilot. A free service sleep/restart discards it. No 24/7 or account-blocking guarantee. No model fine-tuning. External employer destinations outside the Naukri pilot remain blocked and require a separately approved adapter. OTP/CAPTCHA, unknown consents, unsupported controls and login expiry require attended review; this dialog cannot complete a CAPTCHA. The receipt is displayed in the pilot and is not written into dashboard application totals. Do not infer submission from a tab opening, HTTP 200, upload success or a screenshot fixture.

## Verification

`node --test scripts/naukri-workflow.test.cjs scripts/cloud-browser.test.cjs scripts/naukri-flow.test.cjs` uses synthetic pages and a deterministic planner for workflow tests. It checks actual browser field filling, resume-upload receipt handling, unknown-answer handoff, stop-before-submit, and uncertain-result handling. These checks do not prove a real Naukri application or a live model request.
