# Contact form email delivery

- Page: `/contact`; backend: `POST /contact`.
- Destination: `CONTACT_TO_EMAIL` in `backend-api/.env` (currently helloapplybro@gmail.com).
- Provider: FormSubmit's free AJAX endpoint, https://formsubmit.co/ajax-documentation . No paid SDK, SMTP password or API key is installed.
- Email formatting uses documented `_template: table` (HTML table). `_replyto` is the validated visitor email. Destination and subject prefix are controlled by the server.
- Documentation: https://formsubmit.co/ . FormSubmit requires the recipient to click the first activation email. Until this is complete, provider refusals return HTTP 503; the UI does not claim delivery.
- The backend includes the configured `FRONTEND_URL` as the form source/Referer. Set it to the deployed public origin for production. Website `NEXT_PUBLIC_API_URL` must point at the deployed NestJS API.
- Validation: typed fields, 10–5000 character messages, approved subject list, explicit third-party contact consent, honeypot, five attempts per client per 15 minutes. In-memory limits apply per process; use a shared limit store for multiple server instances.
- User messages are not logged or stored in the application database. Email delivery routes through FormSubmit to the recipient mailbox; this is disclosed next to submit and in the Privacy page.
- Backend must remain running to deliver messages.

Owner step: check inbox/Spam for the FormSubmit activation email and click Activate Form. Then submit a test from `/contact` and check the mailbox for the formatted message. Provider acceptance does not verify mailbox delivery; no inbox-reading integration is available here.

Regression checks: `npm.cmd --prefix backend-api run build`, then `node --test backend-api/scripts/contact.test.cjs`.
