# Admin pricing and public promotions

- Admin `http://localhost:3001/offers`: add R2 image banners and daily deals. Active items appear only on Home in a compact bottom-right offer popup, in configured order. Banners and deals rotate every 6.5 seconds, with pause and previous/next controls. The popup opens after 7 seconds once per browser session; visitors can close it and reopen using the Offers button. Pricing has no promotional popup.
- Admin `http://localhost:3001/pricing`: add/edit/delete plans, monthly amount, annual total, currency, free trial days, features, order, featured state and publication state.
- Public pages refresh their API data every 30 seconds. Empty databases show no invented prices or offers. Pricing failures show an unavailable message.
- `GET /pricing` returns published plans; `GET /pricing/admin` also returns drafts. `POST /pricing`, `PUT /pricing/:id`, `DELETE /pricing/:id` persist changes in PostgreSQL.
- Annual prices are explicit annual totals. No automatic discount is assumed. Trial days describe an offer; checkout, billing and trial enforcement are separate work.
- Deal validity text is entered by the admin; it is not a fabricated live countdown. Remove a deal when its offer ends.
- Existing admin APIs have no authentication layer yet. Keep the admin/backend local until authentication and authorization are added before public deployment.

Schema setup: `npx prisma db push` then `npx prisma generate` from `backend-api`. Run `node scripts/pricing-smoke.cjs` with the backend running to verify validation, persistence, draft/public filtering and cleanup.

Festive campaigns: check "Show as festive popup when Home opens" in Admin Offers while creating a daily deal. Active flagged deals open immediately in a native modal on each Home visit; the first flagged offer in display order takes priority. A published Diwali Special uses the existing Festival Offer amounts (50% OFF, INR 1999 to INR 999). Billing and trial enforcement remain separate.

## Current Home presentation
The owner replaced all image popups with a slim scrolling offer strip immediately below the hero. Home reads active deals and banner text every 30 seconds. No images or modal overlays are displayed. The former popupOnOpen flag now highlights festive offers in the strip. Hover, keyboard focus, touch and the pause control stop movement; reduced-motion users get a manually scrollable strip. Links keep the published offer destination and student verification notice.
