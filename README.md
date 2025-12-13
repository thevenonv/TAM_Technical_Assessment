# PayPal Payment Integration – Technical Assessment

**Context:** PayPal Technical Assessment  
**Environment:** PayPal Sandbox  

---

## 1. Overview

This project implements a complete PayPal payment integration for a fictitious e-commerce storefront, in accordance with the technical assessment instructions.

The implementation covers:
- PayPal checkout with dynamic shipping calculation
- Unified checkout experience (PayPal + Card payments)
- Back-office refund management using a **zero local storage** (only APIs) approach

The solution uses PayPal’s **JavaScript SDK** on the frontend and **PayPal REST APIs v2** on the backend (server), following PayPal best practices and recommended integration patterns.

---

## 2. Technology Stack

### Frontend
- HTML, CSS, Vanilla JavaScript
- PayPal JavaScript SDK
  - Smart Payment Buttons
  - Card Fields (Hosted Fields)

### Backend
- Node.js
- Express.js
- PayPal REST APIs (Orders, Captures, Refunds)
- OAuth 2.0 server-side authentication (Client ID & Secret)

### Environment
- PayPal Sandbox only
- No real payments or live credentials

---

## 3. Project Structure

```

client/
index.html          # Storefront (Phase 1 & Phase 2)
review.html         # Review & shipping confirmation (Phase 1)
phase2.js           # Unified checkout logic (Phase 2)
backoffice.html     # Back-office UI (Phase 3)
backoffice.js       # Back-office logic

server/
index.js            # Express server (API routes)
paypal.js           # PayPal API wrapper (OAuth, Orders, Refunds)

.env.example
README.md

```
---

## 4. Phase 1 – PayPal Checkout Integration

### 4.1 Order Creation
- Orders are created server-side using:
```

POST /v2/checkout/orders

```
- The order intent is set to `CAPTURE`
- The initial amount includes only the item price (shipping is calculated later)

### 4.2 Buyer Approval
- PayPal Smart Payment Buttons are rendered using the PayPal JS SDK
- The buyer approves the payment on PayPal

### 4.3 Review Page and Dynamic Shipping
After approval:
1. The buyer is redirected to a review page (`review.html`)
2. The backend retrieves the buyer’s shipping address from the PayPal Order
3. Shipping cost is calculated dynamically based on the postal code (NY-based heuristic)
4. The order amount is updated using:
```

PATCH /v2/checkout/orders/{order_id}

```
5. The buyer confirms the updated total

### 4.4 Capture
- The order is finalized using:
```

POST /v2/checkout/orders/{order_id}/capture

```

---

## 5. Phase 2 – Unified Checkout (PayPal + Card)

### 5.1 Buyer Information Collection
- The buyer enters personal and shipping information before choosing a payment method
- Client-side validation ensures required fields are correctly formatted
- Payment options remain hidden until the buyer information is valid and submitted

### 5.2 Payment Methods
The buyer can choose between:
- PayPal (Smart Payment Buttons)
- Credit / Debit Card (PayPal Card Fields)

Both payment methods rely on the same backend Orders API flow.

### 5.3 Card Payments
- Card fields are rendered using PayPal Hosted Fields
- Card data never touches the merchant server (PCI compliant)
- Orders are created and captured using the same endpoints as PayPal payments

---

## 6. Phase 3 – Back-Office Refund Management (Zero Storage)

### 6.1 Design Choice: Zero Storage
Instead of storing transaction data locally, the back-office retrieves transaction and refund information directly from PayPal APIs.

Benefits:
- Improved security
- No duplication of sensitive payment data
- PayPal remains the single source of truth

### 6.2 Refund Execution
- Refunds are performed using:
```

POST /v2/payments/captures/{capture_id}/refund

````
- Both full and partial refunds are supported

### 6.3 Refund History
- Refund history is fetched dynamically from PayPal APIs
- Displayed in the back-office interface
- No local persistence of refund data

### 6.4 Back-Office Security
- Optional HTTP Basic Authentication can be enabled for admin routes
- Credentials are configurable via environment variables

---

## 7. API Endpoints

### Storefront
- `POST /api/orders`  
Create an order
- `GET /api/orders/:orderID`  
Retrieve an order and shipping address
- `PATCH /api/orders/:orderID`  
Update shipping and totals before capture
- `POST /api/orders/:orderID/capture`  
Capture the order

### Back-Office
- `POST /api/admin/refunds`  
Refund a capture (full or partial)
- `GET /api/admin/captures/:captureId/refunds`  
Retrieve refund history directly from PayPal

---

## 8. Configuration

### Environment Variables

Using a `.env` file. We can look at the `.env.example` file

Frontend:

* The PayPal JS SDK is loaded in `index.html` using the sandbox `client-id`
* You need to replace the client-id with your own sandbox credentials

---

## 9. Installation and Run

```bash
npm install
npm start
```

Access:

* Storefront: [http://localhost:3001/index.html](http://localhost:3001/index.html)
* Review page: [http://localhost:3001/review.html](http://localhost:3001/review.html)
* Back-office: [http://localhost:3001/backoffice.html](http://localhost:3001/backoffice.html)

---

## 10. Debugging and Error Handling

* All PayPal API responses include a `PayPal-Debug-Id`
* Backend errors return structured information (`error`, `debugId`, `details`)
* Frontend displays clear error messages
* Back-office logs refund responses and API errors for troubleshooting

---

## 11. Conclusion

This project demonstrates:

* Correct implementation of PayPal JavaScript SDK and Orders API
* Dynamic shipping updates using PATCH before capture
* Unified checkout with PayPal and Card Fields
* Secure refund handling without local transaction storage
* Clear separation between storefront, backend, and back-office logic