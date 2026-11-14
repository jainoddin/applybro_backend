# Live job discovery and application status

`POST /jobs/discover` reads public Greenhouse/Lever employer feeds. Configure `JOB_BOARDS=greenhouse:cloudflare,greenhouse:stripe,greenhouse:airbnb` (default), or approved board slugs, in backend `.env`. No credentials are required for public listings. Feed errors are reported; generated jobs are never substituted. Results are filtered by preferred title words and locations, with a simple profile skill keyword percentage. This is not an AI eligibility assessment. Successful fetches are cached for five minutes.

Listings are stored per user in PostgreSQL JobApplication records. Existing JSON metadata holds the source key, employer form URL, location and fetch time. Deterministic per-user source IDs prevent duplicate imports. Legacy generated records are retained for investigation and hidden from listings, application history and totals. They are not evidence of real submissions.

`POST /jobs/apply/:id` checks record ownership and current source availability, then returns `OPEN_EMPLOYER_FORM`. The frontend opens the official employer form; the user must finish and submit there. It does not mark the record APPLIED. Application totals require a provider receipt or a recorded browser-companion confirmation. Browser observations are distinguished from signed provider receipts; no submission API provider is configured. We do not infer submission from link visits or a login button.

Portal selections are preferences, not account connections. Browser logins to Naukri/LinkedIn cannot be inspected by the backend. The portal connection endpoint rejects simulated verification. Auto submission is disabled in both backend and UI; profile updates cannot enable it. No CAPTCHA/OTP bypass or stored portal passwords are implemented. A browser companion development preview now provides user-initiated session checks, visible Naukri/LinkedIn job imports, basic contact-field fill and review/submit with browser-observed confirmations. See ../browser-companion/README.md. It is not unattended bulk automation or a provider API integration.

Remaining work for broader automation beyond this browser preview: a supported provider integration or a reviewed browser companion running in the user's session; explicit consent and document transfer; site-specific form/question handling; pause for login, OTP/CAPTCHA and unanswered questions; idempotent submission with verifiable confirmation and durable retry history. Public feed access alone does not provide permission or capability to submit to every employer.

Official documentation: https://docs.greenhouse.io/job-board.html and https://github.com/lever/postings-api; LinkedIn partner access: https://learn.microsoft.com/en-us/linkedin/talent/apply-connect

Validation: `npm run build`, then `node --test scripts/jobs.test.cjs`. Live testing must only read public feeds/open forms; never send test applications to real employers.
