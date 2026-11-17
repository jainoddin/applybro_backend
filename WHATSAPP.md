# WhatsApp application questions

## Remembered Naukri login and WhatsApp OTP

The private `/naukri-test` login now has its own OTP bridge, separate from hosted application-answer memory. `NAUKRI_SESSION_KEY` encrypts Naukri cookies/local storage in `secrets/browser-sessions` (or `NAUKRI_SESSION_DIR`). A verified login is restored in a new browser and rechecked against the protected profile. Idle browser cleanup retains the encrypted login; "Disconnect and forget saved login" removes it. Preserve the private key and use a persistent private disk on hosted deployments. An ephemeral/free host can lose its local files on redeploy. Portal revocation/expiry still requires fresh login; CAPTCHA remains manual.

Setup for the user:

1. In WhatsApp Manager, submit a body-only template named, for example, `applybro_login_action`, with exactly two body variables. Suggested body: `ApplyBro needs your action for {{1}}. Request {{2}} expires in 5 minutes. Reply directly to this message with the login code you requested. Never send passwords.` Template approval/category is decided by Meta; do not enable this name until its status is APPROVED.
2. Save `WHATSAPP_OTP_TEMPLATE_NAME=applybro_login_action` and `WHATSAPP_ENABLED=true` privately on the API after approval. Keep the existing access token, phone-number ID, app secret, verify token, business number and supported Graph API version. The OTP template can be configured independently of the generic application-question template.
3. Deploy this API revision before registering `https://applybro-backend.onrender.com/agent/whatsapp/webhook` in the Meta app. Set the verify token to the private environment value and subscribe to `messages` for the business phone number. A locally running API needs an appropriate public HTTPS webhook deployment; a localhost URL cannot receive Meta webhooks. Never paste app secrets or tokens into chat.
4. In ApplyBro Settings/Hosted Agent, pair your own international WhatsApp number by opening the provided wa.me link and sending its PAIR text within five minutes. This is required even if the same number appears on a resume. For a Meta test sender, also register the number as an allowed test recipient in Meta.
5. Open Connect Naukri and log in once. When Naukri asks for one supported OTP field, the helper requests a WhatsApp notification. Use WhatsApp's Reply action on that exact message and send the OTP from Naukri within five minutes. The signed webhook binds it to the verified sender and private browser session. The helper rechecks the unchanged OTP field and verification button before entering it once. Manual input or CAPTCHA prevents automatic entry.

OTP values exist only in short-lived server memory, are consumed once and wiped on consumption/expiry/disconnect. They never enter answer memory, profile fields, durable job logs or the saved browser state. A server restart cancels pending OTP requests. The UI reports unavailable/configuration/expiry cases and keeps manual OTP entry available. `PRIVATE_BROWSER_CALLBACK_KEY` must match between API and browser helper; internal OTP endpoints additionally require the authenticated ApplyBro owner and a current raw-body HMAC. They are not exposed by the frontend proxy. This implementation currently bridges Naukri sign-in OTP; employer-specific application OTPs still use the existing manual handoff.

Validation: backend/frontend builds; `node --test scripts/private-session-store.test.cjs scripts/login-session.test.cjs scripts/whatsapp-otp.test.cjs scripts/whatsapp.test.cjs`. Browser fixtures demonstrate encrypted restore after browser restart and one-use OTP entry; webhook tests reject forged payloads. Provider transport in tests is mocked and is not evidence of a live WhatsApp message.

This optional channel is disabled by default. It does not make a blocked portal accessible or start an offline worker. The in-memory `/naukri-test` pilot is separate and is not connected to this channel yet. The hosted worker supports a planner-identified editable employer field (or one unambiguous empty field). Ambiguous fields stay in the existing private-browser handoff rather than guessing which answer belongs where.

Configure privately on both the API and hosted worker:

```
WHATSAPP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_APP_SECRET=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_BUSINESS_NUMBER=...country-code-and-number...
WHATSAPP_API_VERSION=v...supported-version...
WHATSAPP_TEMPLATE_NAME=applybro_application_question
WHATSAPP_TEMPLATE_LANGUAGE=en_US
```

Use the existing `CLOUD_AGENT_ENCRYPTION_KEY`. Keep the same key across API and worker. No secrets belong in the frontend or Git. Register an approved template with exactly two body text variables: employer field label and request UUID. Suggested text: `ApplyBro needs your answer: {{1}}. Request {{2}}. Reply directly to this message within five minutes to continue this application. Do not send passwords or OTPs.` Sending uses a template regardless of conversation window. Meta acceptance is not proof of delivery; failures/ambiguous sends are never retried automatically.

Apply `prisma/whatsapp.sql` using the existing schema deployment procedure against a development Neon branch first, then the intended deployment after review. It adds three tables and no changes to existing rows. This change does not run schema changes automatically. The API and worker need those tables only when this feature is enabled.

Webhook URL: `https://YOUR-BACKEND/agent/whatsapp/webhook`. Configure the verify token, subscribe the Meta app to messages for your business number, and use the app secret for POST signatures. Request bodies are verified using exact raw bytes. Never expose tokens in URL query parameters except Meta's required verification handshake.

In Hosted Agent, enter your own international WhatsApp number, opt in, open the generated link, and send the PAIR message from that number within five minutes. Refresh connection. Pairing is bound to the authenticated ApplyBro user and the sender's number. Resume numbers are never automatically trusted.

When a compatible hosted task pauses, reply using WhatsApp's **Reply** action on its question message (quoted context is mandatory). Responses are encrypted and bound to owner/run/message/field/current URL. Five-minute expiry, one-use consumption, active task and fresh DOM checks prevent applying an old answer to another job. Unknown selections, multiple fields, expired questions, login/OTP/CAPTCHA remain in ApplyBro.

Optional answer memory: apply `prisma/answer-memory.sql` after `prisma/whatsapp.sql`, using the same development-branch-first schema procedure. Users must enable “Save my WhatsApp answers” after verifying their number. Existing users default to OFF. After successfully filling a reply in the employer field, the hosted worker saves that answer encrypted. Before sending a later question it looks up the exact normalized label, input type and scope. Clearly personal facts can carry across employers; other answers require the same employer, role and origin. No fuzzy/LLM answer matching is used. Salary/notice-period memory expires after 30 days; other saved answers remain until edited, forgotten or the user is deleted. Consent/legal/challenge answers are never reused. A changed field, filled field or invalid answer format prevents reuse. Users can inspect, edit, forget individual/all answers, or disable reuse. Disconnecting WhatsApp stops reuse, but does not delete saved answers. No other user's answers are queried or exposed.

The in-memory `/naukri-test` pilot still does not consume hosted answer memory. No live send or cross-job reuse is enabled simply by adding an access token; webhook, verified contact, approved template, tables, consent and online hosted worker are still required.

Validation: `npm run build`, then `node --test scripts/whatsapp.test.cjs`. Live acceptance requires configured Meta credentials, approved template, development database schema, verified recipient, an online hosted worker and a real inbound reply. No live message or application confirmation is claimed by fixture tests.
