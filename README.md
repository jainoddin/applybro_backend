# ApplyBro Backend

NestJS/PostgreSQL API for ApplyBro: Firebase authentication, candidate profiles,
private resumes, live employer listings, offers, and the hosted browser-agent pilot.
The frontend and admin applications are separate projects and are not included in
this backend repository.

## Local setup

```sh
npm ci
cp .env.example .env
npx prisma generate
npm run build
npm run start:prod
```

Set the real database URL and Firebase server credentials privately. Restore or
migrate the existing core application database before applying the feature SQL
files under `prisma/`. Never upload `.env`, service-account JSON, resume files,
screenshots containing credentials, or session secrets to GitHub.

## Neon PostgreSQL

The existing NestJS/Prisma driver is retained. `neon.ts` describes the Postgres-only
configuration; Firebase authentication and R2 storage remain configured separately.
The Neon CLI project link and credentials are private and are not committed.

After linking the intended project, run `neon deploy` to pull `DATABASE_URL`
(pooled app traffic) and `DATABASE_URL_UNPOOLED` (direct migration/backup traffic)
into the private `.env`. Never point a hosted backend at localhost.

An initial transfer into an empty Neon database can use `pg_dump --format=custom
--no-owner --no-acl` and `pg_restore --no-owner --no-acl --exit-on-error
--single-transaction`. Use private PostgreSQL environment variables for passwords.
Do not overwrite a populated target. Compare all table counts after restoration,
then test `/pricing` and `/offers/deals` through the frontend proxy.

Render does not automatically receive local Neon CLI variables. Import the two
database variables into the backend service's Environment settings and redeploy.
Private backup and env-import files belong under the ignored `secrets/` directory.
The `/health` endpoint checks API liveness; it does not validate database readiness.

## Hosted browser pilot

Merge `cloud-agent.env.example` into the private environment, then run:

```sh
npm run agent:setup
npm run agent:test
npm run agent:smoke
```

`agent:setup` creates the additional queue/verification tables. Locally it creates
a session-encryption key only when absent; deployments must supply the same private
key to API and worker. Keep this key backed up. Automation is disabled by default.

After configuring an always-on server, an approved employer-host list, working
vision-model access, the real HTTPS frontend origin, and a verified email sender:

```sh
npm run agent:worker
```

Users must explicitly enable hosted/AI processing from the authenticated frontend
`/agent` page. Local companion auto batches are disabled by default. The worker
pauses for unknown facts, login, OTP and CAPTCHA. Only supported employer
confirmation messages count as submitted; uncertain outcomes are not blindly retried.
This is a pilot, not verified support for every job portal. Live employer submission
and production hosting must be validated before advertising automatic applications.

Each user's jobs run sequentially through the database user lease. The worker
selects a 240–480 second review floor for each job, pauses before automatic submit
if that window has not elapsed, and re-observes/re-plans before submitting. Forms
and verification may take longer; the window never forces an incomplete submit.
Scrolling is incremental and actions have a short settling delay. These settings
provide readable, conservative pacing; they do not simulate a human identity or
guarantee portal access. Configure the review range in `cloud-agent.env.example`.

## Deployment on Render

- API: Docker Web Service, repository-root `Dockerfile.agent`.
- Worker: Docker Background Worker, command `node scripts/cloud-worker.cjs`.
- Browser: separate private Docker service, command
  `./node_modules/.bin/playwright run-server --port 3000 --host 0.0.0.0`.
- Set `CLOUD_AGENT_BROWSER_WS` on the worker to that browser's private WebSocket
  address. Never expose browser control publicly or share application secrets with
  the browser container.
- API and worker need the same database, encryption key, model configuration and
  hosted-agent flags. Firebase credentials belong only in server environment settings.
- Apply `npm run agent:setup` to the prepared application database before starting
  the worker. An empty database needs the core application schema first.

Render Background Workers/private browser services require appropriate paid compute;
the free sleeping Web Service does not satisfy offline/always-on execution. No Render
resources are provisioned by pushing this repository. Model access, notifications,
container memory and actual employer flows need live acceptance testing.

`Dockerfile.agent` uses the Playwright image matching the pinned package version.
Private configuration and generated files are excluded by `.dockerignore` and
`.gitignore`. Docker deployment was not verified on the development workstation.

## Checks

```sh
npm run build
npx prisma validate
npm run agent:test
npm run agent:smoke
```

Browser fixtures use `CLOUD_AGENT_CHROME_PATH` if supplied, installed Chrome on
Windows, and the Playwright browser on Linux. Database smoke tests create/delete
temporary fixture users and never send employer applications or notification emails.
Some legacy development tests additionally use files from a sibling `frontend-web`
checkout; they are not standalone backend checks.
