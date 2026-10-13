# Farm2Market AI — Starter Project

A clean starter project for a role-based agricultural supply-chain platform.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB Atlas + Mongoose
- Authentication: JWT + bcrypt
- Four roles: farmer, trader, warehouse, transporter

## Requirements
- Node.js LTS (18+; 20+ recommended)
- npm
- MongoDB Atlas account

## 1. Configure MongoDB Atlas
1. Create a free cluster in MongoDB Atlas.
2. In **Database Access**, create a database user and password.
3. In **Network Access**, add your current IP address. For a temporary learning setup, Atlas also permits `0.0.0.0/0`, but it is less secure; remove it when no longer needed.
4. Choose **Connect → Drivers → Node.js** and copy the connection string.
5. Replace `<password>` and the database name as needed. URL-encode special characters in the password.

## 2. Configure backend environment
Open `backend/.env.example`, copy it to `backend/.env`, and fill in:
- `MONGODB_URI`
- `JWT_SECRET` (use a long random secret)

Never commit `.env` to GitHub.

## 3. Install dependencies
Open a terminal in the project root:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Edit `backend/.env` now, then start the backend:

```powershell
npm run dev
```

Open a second terminal from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL Vite prints, usually `http://localhost:5173`.

## 4. Test
- Backend health check: `http://localhost:5000/api/health`
- On the frontend, create an account using one of the four roles, then log in.
- This is a starter scaffold. Do not use it for real farmer personal data until security, validation, privacy, deployment, and recovery have been reviewed.

## Current starter features
- Role-specific signup/login selection and dashboard view
- Backend password hashing
- JWT-based authentication
- Backend role authorization middleware
- MongoDB Atlas connection
- Responsive starter styling
- Farmer crop-batch registration with reported mandi prices when the official API is configured
- Farmer-controlled batch publication and trader purchase-interest requests
- QR codes linking to a public batch lookup with an allowlisted traceability response
- Warehouse inventory and storage-facility capacity management
- Transporter delivery requests, assignments, and manually updated delivery status
- Explainable rule-based crop spoilage-risk estimates and role-scoped priority alerts

## Mandi market comparison and estimated net return

The farmer dashboard requests prices through the authenticated Express endpoint `GET /api/market/mandi-prices`; the React app never calls the provider directly. The active backend provider is data.gov.in's official AGMARKNET daily mandi-price resource (`9ef84268-d588-465a-a308-a864a43d0070`), configured with a server-only `DATA_GOV_IN_API_KEY`.

```text
DATA_GOV_IN_API_KEY=your_data_gov_in_api_key
```

Never put the API key in a Vite variable, frontend source, or logs.

Supported price filters are commodity, state, district, market/mandi, and optional report date. The live resource identifies itself as “Current Daily Price of Various Commodities from Various Markets (Mandi)” and returns `state`, `district`, `market`, `commodity`, `variety`, `grade`, `arrival_date`, `min_price`, `max_price`, and `modal_price`. The source reports these prices in rupees per quintal; the UI preserves and labels the reported values and labels its per-kg conversion separately.

The searchable State → District → Market suggestions are fetched server-side through farmer-authenticated `GET /api/market/locations`; the API key is never sent to the browser. The resource's search index only permits `offset + limit <= 10,000`, while it currently reports more rows. The backend retrieves that index window, fetches each discovered state's complete pages, and only caches/returns the catalog when the per-state totals sum to the resource total. It retries rate limits using `Retry-After` and fails visibly if totals change or the provider cannot be completely partitioned. Complete catalogs are cached for 15 minutes. The frontend does not fall back to a static snapshot when the API fails. The separate farmer-authenticated `GET /api/market/status` endpoint makes one bounded connectivity check and returns sanitized configuration/reachability/status metadata.

### Mandi location suggestions: live API catalog

The dropdowns use unique, sorted State/District/Market values from the completely retrieved data.gov.in resource. Names are normalized for redundant whitespace without merging different case-sensitive official names. Live price data uses the same backend-only provider configuration.

If the live location API fails, the location lists remain empty and the UI shows the translated error/retry state; it does not substitute static or invented names. Parent selection clears dependent selections, and District/Market remain disabled until their parent selection is valid.

Price requests use the same official data.gov.in resource with the selected commodity, state, district, market, and report date filters. Results are cached in backend memory for five minutes. The separate `agmarknetService.js` helper is not mounted by the market routes and is not the active price source.

The mapper uses the live resource's actual field names and preserves source min/max/modal values in ₹/quintal. The UI labels an explicitly divided-by-100 modal value separately as ₹/kg for return calculations. Every displayed record retains its official arrival date and is presented as a latest reported record, not a live auction quote or guaranteed farmer selling price. Empty responses say that no official price record was found and offer to clear optional filters.

The calculation is gross = entered quantity in kg × reported modal price in ₹/kg, where the official ₹/quintal modal price is divided by 100; estimated net subtracts only explicitly entered transport, handling/storage, and other costs. Farm-entered distance is optional and does not affect the calculation; no costs are inferred. The estimate is not a guaranteed profit, and the eventual selling price may differ. API failures and empty results do not fall back to demo prices.

Run source mapping, date, unit conversion, validation, pagination, caching, diagnostics, and API-error cases with `node --test test/mandi-price-service.test.js` from `backend`. Verify location pagination and completeness handling with `node --test test/mandi-location-service.test.js`. Run calculation tests with `node --test test/market-comparison-service.test.js`. For manual checking, sign in as a farmer, select a state, district, and market, then change each parent selection and confirm its dependent values clear. Use Retry on the location or price error state as applicable. The status check does not expose the API key.

## Next milestones
1. Trader quality grading
2. Voice recognition and text-to-speech are not currently provided
3. Validate the rule-based spoilage-risk thresholds against recorded observations

## Farmer-trader purchase interest

New crop batches are drafts until the farmer publishes them. Authenticated traders can browse published, unsold batches at `GET /api/batches/marketplace` and submit one purchase-interest request per batch at `POST /api/interests/:batchId`. Farmers can review their requests at `GET /api/interests/mine` and accept or reject a pending request with `PATCH /api/interests/:interestId/respond`, sending `{ "decision": "Accepted" }` or `{ "decision": "Rejected" }`. Accepting marks the batch sold and closes other pending requests for that batch; rejecting the last pending request returns the batch to available status. Ownership and role checks are enforced by the API.

Run the backend workflow integration test with `npm test` from `backend`. It uses a temporary MongoDB replica set and creates disposable test-only farmer and trader accounts, including a second farmer for ownership checks. The workflow uses MongoDB transactions to keep request decisions and batch status changes consistent; the configured MongoDB deployment must support transactions (MongoDB Atlas does).

## Public batch traceability

Every persisted batch already has a stable, unique `batchId` (`FM-YYYYMMDD-XXXXXX`). This is reused as the public traceability identifier. Farmer dashboard QR codes point to `${VITE_PUBLIC_FRONTEND_URL}/trace/<batchId>` and can be downloaded as SVG; the legacy `/batches/<batchId>` page remains compatible. The backend endpoint is `GET /api/batches/public/:batchId`, and the page can also be printed.

The public lookup validates the existing batch ID format and returns only an allowlisted projection: traceability ID, batch ID, crop, recorded origin/location, recorded quantity, harvest date, latest recorded batch status and its status-change timestamp, plus purchase-interest decisions, storage and delivery milestones, and the current rule-based risk estimate with its explanation. The risk rating is a time-sensitive estimate, labeled as such, not a scientifically validated prediction. Storage milestones show stored-record status/type and recorded quantities where present. Delivery milestones show recorded delivery status and identify the expected delivery date as estimated. Route pickup/destination, account data, contact details, passwords, JWTs, and internal database IDs are not exposed. A batch's current facts and linked milestones are queried from MongoDB on each lookup, so authorized recorded updates appear on the next page load.

A QR code identifies a platform record; it does not independently prove the crop's authenticity, origin, quality, or safety. Displayed records are entries supplied by participating accounts, not independent certification. Missing optional values are shown as not recorded instead of being inferred.

To test the full flow, create a farmer account and batch, scan/open the QR link shown on its farmer card (or download the SVG and scan it), and confirm the public page shows the same stable batch ID and recorded crop/origin/harvest/quantity/status. Publish the batch and accept a purchase-interest request or record warehouse storage and delivery status; reload the same QR page and confirm the current status and new milestones appear. Try an invalid date/ID in the URL and confirm a validation message; use a valid but unknown batch ID and confirm a not-found message. Check that no account contact information or internal IDs appear, and that the QR opens the same page before and after publication.

Run the ID validation, allowlisted projection, missing-field, and timeline unit cases with `node --test test/traceability-service.test.js` from `backend`. The end-to-end public API and access-boundary test is `node --test test/public-traceability.test.js`; it uses a temporary MongoDB replica set to verify existing QR-link compatibility, updated milestones, and the public privacy boundary.

For local phone testing, run Vite bound to the LAN interface, identify the developer machine's LAN IP (for example `192.168.1.25`), and set `VITE_PUBLIC_FRONTEND_URL=http://192.168.1.25:5173` in the frontend environment. The phone and developer machine must be on the same Wi-Fi, and the backend `VITE_API_URL` must point to an address the phone can reach. Never use `localhost` in a customer QR URL. For customers scanning from anywhere, deploy the frontend at a public HTTPS URL and make the backend/API publicly reachable with appropriate CORS and HTTPS configuration; a private LAN address cannot work outside that network.

## Warehouse inventory and storage

Only authenticated warehouse-role accounts can access `GET/POST /api/warehouses/facilities` and facility inventory routes. Facilities belong to the creating warehouse and store capacity, location, and supported crop types. A warehouse can receive only an existing published, storage-eligible batch for which the farmer has explicitly granted permission through `PATCH /api/batches/:batchId/warehouse-authorization` with `{ "authorized": true }`, and only when the crop is supported by its facility. A farmer can revoke permission with `{ "authorized": false }` once all recorded warehouse inventory for that batch has been dispatched. Intake quantity is checked against the registered batch quantity and available facility capacity in a MongoDB transaction. Inventory searches accept `search`, `crop`, and `status` query filters.

Warehouse users can update valid storage status transitions with `PATCH /api/warehouses/facilities/:facilityId/inventory/:inventoryId/status` and record stock leaving storage with `POST /api/warehouses/facilities/:facilityId/inventory/:inventoryId/outgoing` using `{ "quantityKg": 25 }`. Outgoing quantity updates the remaining inventory and releases facility and batch storage capacity transactionally. Facility and inventory reads/updates are always scoped to the signed-in warehouse.

For the UI workflow, create a warehouse account and register a facility. As a farmer, create and publish an eligible crop batch, then explicitly authorize warehouse storage for that batch. Return to the warehouse account and receive some or all of the authorized batch using its displayed batch ID. Check that an unauthorized batch is rejected, and then check capacity utilization, oldest stored stock, filters, status changes, and partial/final dispatch.

## Transporter and delivery management

Only authenticated transporter accounts can browse requests explicitly shared with their account (`GET /api/deliveries/requests`) or manage their own delivery records (`POST /api/deliveries`, `PATCH /api/deliveries/:deliveryId/status`). In the connected farmer/trader flow, a delivery record is created only after the specifically designated transporter accepts a persisted request. Farmers may share a published batch they own; traders may share a batch only after their purchase interest has been accepted. Both specify the transporter account email and delivery details at `POST /api/deliveries/requests`. A transporter can accept or reject a request with `POST /api/deliveries/requests/:requestId/respond`. Duplicate shares for the same batch/requester/transporter are rejected.

Delivery statuses follow `Requested → Accepted → In Transit → Delivered`, with cancellation allowed from Requested, Accepted, or In Transit. Transporters can see only requests assigned to them and update only their own records. Requesters can view their own shared-request status at `GET /api/deliveries/mine` and progress for accepted deliveries at `GET /api/deliveries/:deliveryId/progress`. Responses omit account contact details. Quantity, cost, batch ID, dates, ownership, role, and status transitions are validated on the server. Duration is calculated from the entered dispatch and expected-delivery dates; route and ETA details are manually entered estimates. GPS tracking, live ETA, and guaranteed delivery times are not provided.

## End-to-end workflow integration

This workflow reuses the stable `batchId` and persisted records from farmer batches, purchase interests, warehouse inventory, delivery shares/deliveries, and risk alerts. The linked records are persisted independently, while each API checks the current user's role and ownership. A farmer must explicitly authorize warehouse storage after publishing; publication for trader interest alone is not warehouse permission. Permission cannot be revoked while any warehouse records positive stored quantity. Warehouse inventory is otherwise accessible only to its owning warehouse. A transporter only receives a delivery record after the specifically addressed transporter accepts a persisted request. No purchase/payment transaction is fabricated: a trader's accepted purchase-interest record is only a recorded decision, not proof of payment or settlement.

Purchase-interest decisions, delivery request responses/status changes, warehouse intake/status/dispatch, and their timestamps are already persisted in the corresponding MongoDB workflow records. Farmer/trader dashboards show their request statuses and counts; transporters see only assigned requests and records; risk alerts are recalculated from linked records and acknowledgments are persisted per user. Public batch traceability adds only allowlisted purchase-decision/status milestones, storage/delivery status milestones, and an explicitly labeled current rule-based risk estimate. It excludes contacts and internal identifiers; GPS and live delivery tracking are not provided.

Run the connected four-role API workflow with `node --test test/end-to-end-workflow.test.js` from `backend`. It covers farmer registration/publication, trader interest and farmer acceptance, explicitly authorized warehouse intake, a rejected transporter request, accepted delivery progress, cancellation, unauthorized operations, farmer-visible estimated net return, and traceability timeline updates. It uses a temporary MongoDB replica set and thus needs the MongoDB test binary available locally. The existing focused authorization and transition suites are `test/purchase-interest.test.js`, `test/warehouse-inventory.test.js`, `test/delivery-management.test.js`, and `test/public-traceability.test.js`; they use the same temporary replica-set setup.

For manual testing with separate accounts: create Farmer, Trader, Warehouse, and Transporter accounts, plus a second transporter to check that shares are private to the selected recipient. The farmer creates a batch, records its estimated net return, and publishes it. The trader submits interest; the farmer accepts or rejects it and confirms the decision remains after refresh. In the farmer account, authorize warehouse storage explicitly; first confirm the warehouse cannot intake before authorization, then register a facility with a supported crop and receive the batch. Share a delivery request with a chosen transporter's registered account email. Confirm an unrelated transporter cannot see or update it; have the selected transporter reject one request, then accept another and move its delivery through In Transit to Delivered (or Cancelled from an allowed state). Verify the farmer/trader sees only their relevant request/progress, refresh the QR traceability page and check purchase decision, storage, delivery and labeled risk entries. Confirm the saved batch still shows its demo-based estimated gross/net and does not imply a completed payment, guaranteed profit, verified origin, or live tracking.

To test with two accounts, create a farmer account and a transporter account, then create and publish a farmer batch. In the farmer dashboard, submit a delivery request using the displayed batch ID, the transporter account email, a quantity no greater than the batch quantity, pickup/destination, non-past dispatch date, expected delivery date, and estimated cost. Sign in as the transporter and confirm the request appears only in that account's dashboard. Accept it, then advance its status through In Transit to Delivered; the farmer can see the status but cannot update it. Repeat with another farmer/transporter account to confirm cross-account requests and delivery records are not exposed. For the trader path, first have a farmer accept that trader's purchase-interest request, then submit a delivery request from the trader dashboard.

The backend delivery workflow integration test is `backend/test/delivery-management.test.js` and runs with `npm test` from `backend`. It uses a temporary MongoDB replica set, so MongoDB transaction support is required (as provided by MongoDB Atlas).

## Crop risk estimates and priority alerts

`GET /api/alerts` recalculates a rule-based batch assessment from current batch harvest dates, remaining warehouse inventory/storage records, and delivery statuses/dates. `POST /api/alerts/:alertKey/acknowledge` acknowledges a currently valid alert for the signed-in user. Alert acknowledgments are stored per user. Alert keys are fingerprints of the triggering conditions, so an alert whose relevant conditions change will be recalculated and can appear as a new unacknowledged alert.

Risk rules are intentionally simple and fixed in `backend/src/services/spoilageRiskService.js`:

- Harvest age: 7–13 days adds 1 point; 14+ days adds 2.
- Remaining stored quantity: 7–13 days in storage adds 1 point; 14+ days adds 2.
- Remaining quantity recorded in Ambient storage for 7+ days adds 1 additional point.
- A currently Accepted/In Transit delivery past its expected date, or a Delivered status recorded after its expected date, adds 2 points.
- 0–1 points is Low, 2–3 is Medium, and 4+ is High.
- A valid harvest date on or before today is required. Missing/invalid harvest or required active-storage/delivery dates show **Insufficient data** rather than a rating. A warehouse can treat no active stored inventory in its own records as no currently recorded storage. Other roles do not receive warehouse records, so their overall risk is **Insufficient data** until that context is available through their existing permissions.

The dashboard also flags dispatch priority after 14+ days since harvest or 7+ days in storage, storage duration at 14+ days, and delivery records past their expected date. Alert visibility is scoped by role: farmers see their own batches and their own delivery requests; traders see batches with accepted purchase interest and their own delivery requests; warehouses see batches with remaining inventory at their own warehouse; transporters see batches and delivery records assigned to them. Only a warehouse sees storage inputs from its own inventory records; other roles do not gain access to warehouse records. Only the alert summary and rule explanations are returned, not account contacts or internal database IDs.

These thresholds are operational heuristics, not scientifically validated crop-specific predictions. The feature does not use weather, sensors, or AI predictions and cannot guarantee whether a crop will spoil.

Run the rule-service unit cases with `node --test test/spoilage-risk-service.test.js` from `backend`. They cover Low/Medium/High rules, storage types, overdue and late-completed delivery dates, insufficient inputs, alert fingerprints, and delayed alerts with incomplete risk data. The role-scope and acknowledgement API test is `backend/test/risk-alert-api.test.js`; it uses a temporary MongoDB replica set and can be run with `node --test test/risk-alert-api.test.js` from `backend`.

For a UI check, sign in as a farmer, create and publish a batch with a harvest date at least 14 days ago, and confirm the dashboard shows a dispatch-priority alert while the score says **Insufficient data** for warehouse context not accessible to the farmer. Sign in as a warehouse account, receive that batch with an Ambient storage date at least 14 days ago, then confirm the warehouse dashboard shows a High estimate with harvest-age, storage-duration, and Ambient-storage explanations and a long-storage alert. Acknowledge the alert, refresh, and confirm it remains marked acknowledged. To check manual delivery-delay alerts, share a delivery request with dispatch and expected-delivery dates set to today, have the transporter accept it and set it In Transit, then check again after the expected date has passed; the requester and assigned transporter should see the delay alert, but unrelated accounts should not. Resetting a relevant status/date or changing stored inventory rules will recalculate the risk and may produce a new alert fingerprint.

## Accessibility and language support

The interface supports English, Telugu, Hindi, and Tamil through the existing i18next resources. The language selector changes the current page without remounting workflow forms, so entered values remain in place. The selection is saved in this browser; a saved account language is applied again when signing in.

Known API errors use stable response codes, and the frontend translates them in the selected language without displaying the backend's English error text. Covered categories include invalid input, duplicate account or record, conflicting action, missing record, required sign-in, invalid/expired session, incorrect login credentials, forbidden access, network failure, and server/request failure. Form validation feedback is localized as well, including native required, email, length, number, and range errors. The backend retains its existing `message` field for compatibility, but the frontend intentionally does not show that text. Server-side validation currently displays a translated general input message rather than translating each field-specific backend explanation. Unknown API codes/errors use a safe translated fallback. UI success notifications for batch publication, purchase interest, warehouse operations, and delivery workflows use stable notice codes and are localized; their English API `message` values remain for compatibility. The interface does not provide voice recognition or text-to-speech.

### Manual language and accessibility checklist

- [ ] Select **English**, then check the home page, sign-up/login form, Farmer dashboard, Trader dashboard, Warehouse dashboard, Transporter dashboard, public traceability page, loading states, empty states, alerts, and validation messages.
- [ ] Repeat the same screen checklist in **తెలుగు (Telugu)**, **हिन्दी (Hindi)**, and **தமிழ் (Tamil)**. Confirm labels and workflow actions are understandable and no `ui.*` translation keys appear.
- [ ] Start entering a form (for example, the farmer batch form or warehouse facility form), change the language, and verify the entered values remain unchanged.
- [ ] Use only Tab, Shift+Tab, Enter, Space, and arrow keys to navigate the language selector, dashboard actions, forms, and status controls. Confirm the focus indicator remains visible.
- [ ] Submit an empty or out-of-range form and verify the browser or inline error is announced, is understandable, and is associated with the labeled control.
- [ ] Try a duplicate account, invalid credentials, an expired/missing session, an unauthorized role action, and a missing batch record. Confirm each error is translated and does not show raw backend text.
- [ ] Turn off the network during an API action and confirm the translated connection error appears; restore the connection and retry.
- [ ] Verify text, controls, and focus indicators remain distinguishable with readable contrast.
- [ ] On a narrow/mobile viewport, verify fields and action buttons remain readable, reachable, and comfortably tappable.
- [ ] Confirm the market feature still says demo/not live, delivery dates remain estimates without GPS/live ETA, and risk is described as a rule-based estimate.

Run locale and API-error translation checks from `frontend` with `npm run test:i18n`; run the production build with `npm run build`. Run backend error-code tests with `node --test test/api-error-codes.test.js` from `backend`.
### Official mandi data and price attribution

The backend uses the configured official data.gov.in AGMARKNET daily-price resource for both location suggestions and reported prices. The separate AGMARKNET web-dashboard helper is not mounted by the market routes and is not used as a fallback. Displayed records retain their actual report date and source values; a reported price is not a live auction quote or a guarantee of what a farmer will receive. Crop registration and batch creation remain available if official price data is unavailable; no sample prices are substituted.
