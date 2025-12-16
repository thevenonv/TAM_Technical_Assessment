# PayPal Payment Integration — Technical Assessment

## 1. Overview

This project demonstrates a complete PayPal payment flow including:
- PayPal Checkout and card payments using a unified backend
- Dynamic order updates (shipping & totals) before capture
- Secure server-side payment capture
- Back-office refund management (full & partial) with PayPal webhooks for near real-time updates

PayPal is the source of truth; no local JSON cache is used anymore.

## 2. Server-Side API Endpoints

### Storefront Endpoints
| Endpoint                       | Method | Description                                                            |
| ------------------------------ | ------ | ---------------------------------------------------------------------- |
| `/api/orders`                  | POST   | Creates a PayPal order using the Orders API (v2) with `CAPTURE` intent |
| `/api/orders/:orderID`         | GET    | Retrieves order details and shipping information from PayPal           |
| `/api/orders/:orderID`         | PATCH  | Updates shipping cost and order total after buyer approval             |
| `/api/orders/:orderID/capture` | POST   | Captures the authorized payment                                        |

**Key PayPal APIs used**
- `POST /v2/checkout/orders`
- `GET /v2/checkout/orders/{id}`
- `PATCH /v2/checkout/orders/{id}`
- `POST /v2/checkout/orders/{id}/capture`

### Back-Office Endpoints
| Endpoint                                 | Method | Description                                                            |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `/api/admin/refunds`                     | POST   | Executes full or partial refunds on a capture                          |
| `/api/admin/captures/:captureId/refunds` | GET    | Retrieves refund history for a given capture                           |
| `/api/admin/webhooks/refunds/:captureId` | GET    | Latest refund totals received via PayPal webhook for this capture      |

**Key PayPal APIs used**
- `POST /v2/payments/captures/{id}/refund`
- `GET /v2/payments/captures/{id}/refunds`
- `POST /v1/notifications/verify-webhook-signature` (webhook verification)
- Webhook events: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.PARTIALLY_REFUNDED`

## 3. Configuration & Testing Setup

### Environment Configuration
Create a `.env` from `.env.example` and set:
```env
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_SECRET=your_sandbox_client_secret
PAYPAL_WEBHOOK_ID=8VP710141R3723340
```
Expose your server publicly (Render, ngrok, localtunnel, etc.) and register the HTTPS webhook URL in PayPal pointing to `/api/webhooks/paypal`.

### Run the Application
```bash
npm install
npm start
```

### Access Points
- Storefront: `http://localhost:3001/index.html`
- Review page: `http://localhost:3001/review.html`
- Back-office (PayPal + webhooks): `http://localhost:3001/backoffice.html`

## 4. Design Decisions

### Unified Order Flow
A single backend order lifecycle is shared between PayPal Smart Buttons and Card Payments (PayPal Hosted / Card Fields) to avoid duplicated logic.

### Dynamic Shipping Update After Approval
Shipping costs are calculated after buyer approval using the postal code provided by PayPal; the order is patched before capture for correct totals.

### Webhooks for Real-Time Refunds
PayPal webhooks are received at `/api/webhooks/paypal` (signature verified with `PAYPAL_WEBHOOK_ID`). The backoffice reads `/api/admin/webhooks/refunds/:captureId` to display near real-time refund totals without local persistence.

### Secure Payment Handling
- OAuth 2.0 authentication handled server-side
- Card data never reaches the backend
- All sensitive operations (capture, refunds) are executed server-side only

## 5. Project Structure
```
client/
  index.html        # Storefront (Phase 1 & 2)
  app.js            # Unified checkout logic (PayPal + Card)
  review.html       # Order review & shipping confirmation
  review.js         # Review page logic
  backoffice.html   # Refund back-office UI (PayPal reporting + webhooks)
  backoffice.js     # Refund logic for the backoffice

server/
  index.js          # Express server & routes (webhooks included)
  paypal.js         # PayPal API wrapper

videos/
  Video_Phase1.mp4  # PayPal Checkout & dynamic shipping demo
  Video_Phase2.mp4  # Unified checkout (PayPal + Card) demo
  Video_Phase3.mp4  # Back-office refund management demo

.env.example
README.md
```

## 6. Sandbox Reference Transactions

### Phase 1 — PayPal Checkout
| Identifier      | Value             |
| --------------- | ----------------- |
| Order ID        | 17A58597EV6721430 |
| Capture ID      | 4T4836865P1150937 |
| PayPal Debug ID | f63838852c156     |

### Phase 2 — Card Payment
| Identifier      | Value             |
| --------------- | ----------------- |
| Order ID        | 7B498598BH332464T |
| Capture ID      | 01X5014339764721V |
| PayPal Debug ID | f629127f2e463     |

### Phase 3 — Refund Management
**Partial Refund**
| Identifier | Value             |
| ---------- | ----------------- |
| Order ID   | 97041993PG632723D |
| Capture ID | 5F395483SD1827037 |
| Refund ID  | 5UH85635EH747143Y |
| Amount     | 15.99 USD         |

**Full Refund**
| Identifier | Value             |
| ---------- | ----------------- |
| Order ID   | 7E847069F23470119 |
| Capture ID | 3T401736LP9120341 |
| Refund ID  | 2270745716703322D |
| Amount     | FULL              |

## 7. Error Handling & Debugging
- Every PayPal API response exposes a `PayPal-Debug-Id`
- Errors are returned in a structured JSON format
- Debug IDs can be used directly in PayPal’s internal troubleshooting tools

## 8. Summary
- Proper server-side use of PayPal Orders, Capture, Refund, and Webhook APIs
- Dynamic order updates before capture
- Unified checkout architecture (PayPal + Cards)
- Secure, API-driven refund management with webhooks for freshness
- No local JSON cache; PayPal remains the source of truth
