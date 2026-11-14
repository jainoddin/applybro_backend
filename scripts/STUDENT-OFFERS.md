# Student offers and review access

Published monthly totals (including GST): regular reference INR284.29, 30% INR199.00, 40% INR170.57, student 50% INR142.15. Annual totals are monthly x12 as confirmed by the owner. No GST rate or invoice breakdown has been assumed. Amounts are rounded in paise.

- Public verification: `/student-offer`. Student name, printed ID name, email, college and student ID number plus one PNG/JPEG/WebP up to 5 MB.
- Mismatched entered names are rejected with a correction reason. A rejected request can be resubmitted; pending/approved requests cannot be overwritten.
- Admin: `http://localhost:3001/students`. Sign in with `STUDENT_REVIEW_KEY` from `backend-api/.env`. It was generated locally and is never exposed in browser bundles. The session uses an HttpOnly cookie and expires after eight hours.
- Photos are stored privately in PostgreSQL, not public R2. Only the authenticated review session can read them. Responses are not cached.
- Reviewer must inspect the actual image, compare the institution/ID details, and type the name read from the photo. Approval with a mismatched name is rejected by the API. Rejection requires a reason visible to the applicant.
- Claim is allowed only after approval, uses server-side pricing, and is idempotent. A claim reserves the offer and returns a reference. It does not activate a paid subscription or take payment: payment processing and real user OAuth/account linkage are still pending.
- Applicant access is a random capability token stored in that browser, with only its hash in the database. Email is not verified by this flow. Keep the browser data until review completes; account recovery is not implemented.
- School IDs are sensitive. Use a private trusted environment for review and explicitly decide production retention, backup protection and account authentication before opening real student intake publicly.

Checks: start the backend, then `node scripts/student-smoke.cjs`. It covers access control, private image access, mismatch rejection, re-upload, manual review, claim gating and test-record cleanup. `configure-offer-pricing.cjs` is the one-time owner-requested publication script; re-running it overwrites the named plans and promotional offers.
