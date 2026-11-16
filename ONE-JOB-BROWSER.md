# Single application in the existing private Naukri browser

The `/naukri-test` page now has a one-job action after a verified login. It reuses that exact browser context, not a local Chrome account and not a new login. An incomplete Naukri homepage with Complete profile, My home and recommended jobs is recognized as signed in.

The authenticated API reads the current user's immutable saved resume bytes and raw saved profile fields from `/profile/browser-material`. It does not use UI defaults for salary, notice period or work rights, and does not infer unknown answers from a name or job description. Review your saved candidate details before starting.

The user enters one exact Naukri listing URL, title and company and authorizes the upload and application. The private browser uploads the saved file to the profile, requires a fresh upload receipt, and opens the listing. The existing vision planner receives a masked screenshot, visible controls and saved facts. It selects one action at a time; the executor validates it against the current DOM, fills only supported fact bindings, and observes again. Unknown questions pause for owner input. No CAPTCHA, account restrictions or login protections are bypassed.

Before a submission, the executor checks job/company identity, required fields, verification challenges and the confirmed resume upload. It reserves one submission attempt. Only a subsequent portal receipt reports CONFIRMED. Uncertain results report UNKNOWN and are never automatically retried. Stop also blocks a pending model response from causing a later submit. Activity, masked screenshots and the result are visible in the dialog.

## Deployment

Build/deploy the main backend, frontend, and the existing browser service with `Dockerfile.browser-test`. The image compiles only `agent-policy.ts` for its shared executor; it does not start another Nest API. Preserve existing browser transport and authentication settings. Add `CLOUD_AGENT_MODEL` and `CLOUD_AGENT_API_KEY` (or `GEMINI_API_KEYS`) privately to the browser service. Enable `www.naukri.com` in `CLOUD_AGENT_ALLOWED_HOSTS` for recognized navigation links. No secrets belong in Git or in browser code.

The Next proxy forwards only the exact authenticated `job-start`, `job-status`, `job-answer` and `job-stop` operations. Candidate material is fetched directly between servers with the requesting user's authorization and no-store responses. It is never loaded from another user's browser. One attempt per session; status polling never runs an action.

## Limits

This is a bounded, in-memory, 30-minute single-job pilot. A free service sleep/restart discards it. No 24/7 or account-blocking guarantee. No model fine-tuning. External employer destinations outside the Naukri pilot remain blocked and require a separately approved adapter. OTP/CAPTCHA, unknown consents, unsupported controls and login expiry require attended review; this dialog cannot complete a CAPTCHA. The receipt is displayed in the pilot and is not written into dashboard application totals. Do not infer submission from a tab opening, HTTP 200, upload success or a screenshot fixture.

## Verification

`node --test scripts/naukri-workflow.test.cjs scripts/cloud-browser.test.cjs scripts/naukri-flow.test.cjs` uses synthetic pages and a deterministic planner for workflow tests. It checks actual browser field filling, resume-upload receipt handling, unknown-answer handoff, stop-before-submit, and uncertain-result handling. These checks do not prove a real Naukri application or a live model request.
