# PayPal Payment Integration – Technical Assessment

**Context:** PayPal Technical Assessment
**Environment:** PayPal Sandbox

This project implements a complete PayPal payment flow for a fictitious e-commerce store, *Unleaded*, following the official PayPal JavaScript SDK and REST API guidelines.

The integration is built progressively across three phases, each reflecting a real-world merchant use case: checkout, card payments, and refunds via a back-office system.

---

## Implemented Features

### Phase 1 – PayPal Checkout & Dynamic Shipping

* PayPal Smart Payment Buttons integration
* Server-side order creation using the **Orders API (v2)** with `CAPTURE` intent
* Buyer approval followed by a review page
* Dynamic shipping calculation based on the buyer’s postal code
* Order total updated **after approval and before capture** using the `PATCH /orders/{id}` endpoint
* Immediate capture after buyer confirmation

### Phase 2 – Unified Checkout (PayPal + Card Payments)

* Single checkout flow where buyers first enter their personal and shipping information
* Two payment options:

  * PayPal (Smart Buttons)
  * Credit/Debit Card (PayPal Card Fields / Hosted Fields)
* Shared backend order flow for both payment methods
* PCI-compliant card handling (card data never reaches the server)

### Phase 3 – Back-Office Refund Management

* Dedicated back-office interface for customer support
* Full and partial refunds supported
* Refunds executed directly via the **Captures Refund API**
* **Zero local storage design**: all transaction and refund data is fetched live from PayPal APIs
* Optional basic authentication for admin routes

---

## Technology Stack

**Frontend**

* HTML, CSS, Vanilla JavaScript
* PayPal JavaScript SDK (Smart Buttons & Card Fields)

**Backend**

* Node.js & Express
* PayPal REST APIs (Orders, Captures, Refunds)
* OAuth 2.0 server-side authentication

**Environment**

* PayPal Sandbox only
* No live credentials or real payments

---

## Project Structure

```
client/
  index.html        # Storefront (Phase 1 & 2)
  review.html       # Order review & shipping confirmation
  phase2.js         # Unified checkout logic
  backoffice.html   # Refund back-office UI
  backoffice.js     # Refund logic

server/
  index.js          # Express server & routes
  paypal.js         # PayPal API wrapper

.env.example
README.md
```

---

## API Endpoints

**Storefront**

* `POST /api/orders` – Create an order
* `GET /api/orders/:orderID` – Retrieve order & shipping details
* `PATCH /api/orders/:orderID` – Update shipping and totals
* `POST /api/orders/:orderID/capture` – Capture payment

**Back-Office**

* `POST /api/admin/refunds` – Full or partial refund
* `GET /api/admin/captures/:captureId/refunds` – Retrieve refund history

---

## Required Identifiers

## Phase 1 – PayPal Checkout (Sandbox)

| Identifier          | Value               |
| ------------------- | ------------------- |
| **Order ID**        | `17A58597EV6721430` |
| **Capture ID**      | `4T4836865P1150937` |
| **PayPal Debug ID** | `f63838852c156`     |

---

## Phase 2 – Card Payment (Sandbox)

| Identifier          | Value               |
| ------------------- | ------------------- |
| **Order ID**        | `7B498598BH332464T` |
| **Capture ID**      | `01X5014339764721V` |
| **PayPal Debug ID** | `f629127f2e463`     |

---

## Phase 3 – Refund Management (Back-Office)

### 🔹 Partial Refund (Sandbox)

| Identifier          | Value               |
| ------------------- | ------------------- |
| **Order ID**        | `97041993PG632723D` |
| **Capture ID**      | `5F395483SD1827037` |
| **Refund ID**       | `5UH85635EH747143Y` |
| **PayPal Debug ID** | `f84318013aea2`     |
| **Refund Amount**   | `15.99 USD`         |

---

### 🔹 Full Refund (Sandbox)

| Identifier          | Value               |
| ------------------- | ------------------- |
| **Order ID**        | `7E847069F23470119` |
| **Capture ID**      | `3T401736LP9120341` |
| **Refund ID**       | `2270745716703322D` |
| **PayPal Debug ID** | `f2196689e915b`     |
| **Refund Amount**   | `FULL`              |

---

## Configuration & Run

1. Create a `.env` file based on `.env.example`
2. Add your PayPal **Sandbox Client ID & Secret**
3. Install and start the project:

```bash
npm install
npm start
```

Access:

* Storefront: `http://localhost:3001/index.html`
* Review page: `http://localhost:3001/review.html`
* Back-office: `http://localhost:3001/backoffice.html`

---

## Debugging & Error Handling

* All PayPal API responses expose a `PayPal-Debug-Id`
* Backend errors return structured details for troubleshooting
* Frontend and back-office display clear error messages

---

## Summary

This project demonstrates:

* Correct use of the PayPal JavaScript SDK and Orders API
* Dynamic order updates before capture
* A unified PayPal + card checkout experience
* Secure, API-driven refund management
* Clean separation between frontend, backend, and back-office logic

---