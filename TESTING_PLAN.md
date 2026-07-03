# ReBrew — Complete Manual Testing Plan
**Environment:** Production (or staging with live Stripe test keys)  
**Base URL:** `https://api.rebrew.in/api/v1`  
**Tool:** curl, Postman, or browser DevTools Network tab  
**Before starting:** Server is running, MongoDB connected, Stripe webhook active.

---

## NOTATION

```
→   POST/GET/PUT/DELETE request
◉   Expected response body field
✓   Pass condition
✗   Failure indicator
```

All responses are JSON with shape `{ success: bool, message: string, data: {} }`.

---

---

# CUSTOMER FLOWS

---

## C1 — Register

### Steps

1. `POST /auth/register`
```json
{
  "name": "Test Customer",
  "email": "testcustomer@rebrew.in",
  "password": "TestPass123",
  "phone": "9876543210"
}
```

2. Check inbox for `testcustomer@rebrew.in`.

### Expected Result

- HTTP `201`
- `success: true`
- `message: "Account created successfully"`
- `data.user.email` = `"testcustomer@rebrew.in"`
- `data.user.role` = `"customer"`
- `data.accessToken` present (string, non-empty)
- `token` cookie set in response headers (`HttpOnly`, `Secure` in production)
- Welcome email received with subject: `"Welcome to ReBrew 🍊"`

### Failure Indicators

- `✗` HTTP 409 — email already registered (run with fresh email)
- `✗` HTTP 422 — password failed validation (must have uppercase + lowercase + number)
- `✗` No welcome email after 2 minutes — check `SMTP_PASS` in `.env`, check `pm2 logs rebrew-api`
- `✗` `data.user.role` is not `"customer"` — model default broken
- `✗` No cookie set — check `NODE_ENV=production` and `HTTPS` is active

---

## C2 — Login

### Steps

1. `POST /auth/login`
```json
{
  "email": "testcustomer@rebrew.in",
  "password": "TestPass123"
}
```

2. Save the `accessToken` from the response — used in all subsequent authenticated requests as header: `Authorization: Bearer <token>`

### Expected Result

- HTTP `200`
- `success: true`
- `message: "Login successful"`
- `data.accessToken` present
- `token` and `refreshToken` cookies set

### Failure Indicators

- `✗` HTTP 401 with `"Invalid email or password"` — credentials wrong
- `✗` HTTP 429 — rate limiter hit (10 attempts per 15 min per IP); wait 15 minutes
- `✗` HTTP 403 — account deactivated (should not occur on fresh account)
- `✗` Missing cookies — HTTPS not active or `sameSite` blocking in dev environment

---

## C3 — Logout

### Steps

1. `POST /auth/logout`  
   Header: `Authorization: Bearer <token>`

2. Immediately retry: `GET /auth/profile` with the same token.

### Expected Result

- HTTP `200`
- `message: "Logged out successfully."`
- `token` and `refreshToken` cookies cleared (Set-Cookie with `Max-Age=0`)
- Subsequent `GET /auth/profile` with same token returns HTTP `401` (token is still cryptographically valid — logout is cookie-based, not token blacklist; using `Authorization` header with the same JWT would still work — this is expected for cookie-auth logout)

### Failure Indicators

- `✗` HTTP `401` on logout itself — `protect` middleware not finding the token
- `✗` Cookies not cleared in response headers — `clearTokenCookie` not running
- `✗` HTTP `200` on unauthenticated-origin request to `/auth/logout` — `protect` middleware missing (was a bug, now fixed; verify it returns 401 without a valid token)

---

## C4 — Forgot Password

### Steps

1. `POST /auth/forgot-password`
```json
{ "email": "testcustomer@rebrew.in" }
```

2. Check inbox for password reset email.

3. Try same endpoint with a **non-existent email**:
```json
{ "email": "nobody@rebrew.in" }
```

### Expected Result

- HTTP `200` for **both** requests (real and fake email)
- `message: "If an account with that email exists, a reset link has been sent."`
- Reset email received for real account, subject: `"Reset Your ReBrew Password"`
- Email contains a link with `?token=<hex_string>`
- **No email sent** for the fake address (verify no SMTP error in logs)
- Both responses take approximately the same time (timing-safe, prevents email enumeration)

### Failure Indicators

- `✗` HTTP `404` or different message for real vs fake email — email enumeration vulnerability
- `✗` No email after 2 minutes — SMTP config issue
- `✗` HTTP `429` — rate limiter working correctly (3 per hour); wait or test from different IP
- `✗` Reset link URL contains `undefined` — `FRONTEND_URL` env var not set

---

## C5 — Reset Password

### Steps

1. From the reset email, extract the token from the link:  
   `https://rebrew.in/reset-password?token=<TOKEN>`

2. `POST /auth/reset-password`
```json
{
  "token": "<TOKEN_FROM_EMAIL>",
  "password": "NewPass456"
}
```

3. Try to use the same token a second time.

4. Login with old password `TestPass123`.

5. Login with new password `NewPass456`.

### Expected Result

- HTTP `200` first use
- `message: "Password reset successful. Please log in."`
- Cookies cleared in response (re-login required)
- Second use of same token: HTTP `400` with `"Invalid or expired reset token"`
- Login with old password: HTTP `401`
- Login with new password: HTTP `200`

### Failure Indicators

- `✗` Token accepted twice — reset token not cleared after use
- `✗` Old password still works — `user.password = newPassword` not saving
- `✗` HTTP `400` on first use — token expired (10-minute window), request a new one
- `✗` `"Invalid or expired reset token"` immediately — SHA-256 hash mismatch (double-hashing bug)

---

## C6 — Browse Products

### Steps

1. `GET /products` — no auth required

2. `GET /products?flavor=grape`

3. `GET /products?sort=popular&limit=3`

4. `GET /products?search=ginger`

5. `GET /products/featured`

### Expected Result

- HTTP `200` for all requests
- `data` is an array of product objects
- Each product has: `name`, `flavor`, `price`, `stock`, `images`, `slug`
- `meta.total`, `meta.page`, `meta.limit`, `meta.totalPages` present
- Flavor filter returns only products with `flavor: "grape"`
- Featured endpoint returns `isFeatured: true` products only
- `stripeProductId` and `stripePriceId` NOT present in any response (select: false)

### Failure Indicators

- `✗` Empty `data` array when products exist in DB — `active: true` filter excluding them
- `✗` `stripeProductId` visible in response — sensitive field exposure
- `✗` `meta` missing — pagination broken
- `✗` HTTP `422` on `?search=` — validator rejecting empty string

---

## C7 — Product Detail

### Steps

1. Take a `slug` from the products list (e.g. `"rebrew-grape"`)

2. `GET /products/rebrew-grape`

3. Take a `_id` from the products list

4. `GET /products/<objectId>`

5. `GET /products/nonexistent-slug-999`

### Expected Result

- HTTP `200` for slug lookup
- HTTP `200` for ObjectId lookup
- Both return same product object
- HTTP `404` for nonexistent slug with `"Product not found."`

### Failure Indicators

- `✗` HTTP `500` on ObjectId lookup — CastError not caught by error middleware
- `✗` HTTP `200` for deactivated product — `active: true` filter missing from `getProduct`
- `✗` Different data returned by slug vs ID — both paths should hit same product

---

## C8 — Add to Cart

### Steps

1. Login as `testcustomer@rebrew.in`

2. Get a product ID from `GET /products`

3. `POST /cart/add`  
   Auth: Bearer token
```json
{
  "productId": "<product_id>",
  "quantity": 2
}
```

4. `POST /cart/add` with same product, quantity 1 (should accumulate to 3)

5. `POST /cart/add` with `quantity: 0`

6. `POST /cart/add` with `quantity: 100`

7. `GET /cart`

### Expected Result

- HTTP `201` on first add
- `message: "ReBrew Grape added to cart."` (product name in message)
- Server-side `price` in response matches DB price — NOT the price sent by client (no price field in request body)
- Second add: quantity accumulates to 3, not reset to 1
- `quantity: 0`: HTTP `422` — validator rejects (min: 1)
- `quantity: 100`: HTTP `400` — exceeds available stock (unless stock > 100)
- `GET /cart`: returns `items` array with `total` and `itemCount` virtuals

### Failure Indicators

- `✗` Price in cart item differs from `GET /products` price — price re-validation not working
- `✗` `quantity: 0` returns `200` — validator not running
- `✗` Cart returns HTTP `401` — `protect` middleware not applied
- `✗` Two separate line items instead of accumulated quantity — existing item lookup broken
- `✗` `total` is `0` — virtual not computed (check `toJSON: { virtuals: true }`)

---

## C9 — Update Cart

### Steps

1. `PUT /cart/update`
```json
{
  "productId": "<product_id>",
  "quantity": 1
}
```

2. `PUT /cart/update` with `quantity: 0` (should remove item)

3. `GET /cart` — verify item removed

4. `DELETE /cart/remove`
```json
{ "productId": "<product_id>" }
```
(Add item first if cart is now empty)

5. `DELETE /cart/clear`

### Expected Result

- Quantity update: HTTP `200`, `"Cart updated."`, quantity changed to 1
- Quantity 0: HTTP `200`, `"Item removed from cart."`
- `GET /cart` after removal: item gone from `items` array
- `DELETE /cart/remove`: HTTP `200`, `"Item removed from cart."`
- `DELETE /cart/clear`: HTTP `200`, `"Cart cleared."`, subsequent `GET /cart` returns empty items

### Failure Indicators

- `✗` HTTP `404` on update — item not found in cart (check productId matches exactly)
- `✗` Price not refreshed after update — stale price in cart
- `✗` Cart still has item after `quantity: 0` update — removal logic broken

---

## C10 — Checkout (Stripe)

### Steps

1. Add 1 item to cart (price ₹149 — total below ₹499 so ₹40 shipping applies)

2. `POST /cart/validate` — verify cart before checkout

3. `POST /payments/create-checkout-session`  
   Auth: Bearer token
```json
{
  "shippingAddress": {
    "fullName": "Test Customer",
    "line1": "123 Test Street",
    "city": "Coimbatore",
    "state": "Tamil Nadu",
    "pincode": "641001",
    "phone": "9876543210"
  },
  "customerNote": "Test order"
}
```

4. Open `data.sessionUrl` in browser

5. In Stripe Checkout page, use test card:  
   `4242 4242 4242 4242` | Expiry: any future | CVC: any 3 digits | Zip: any

6. Complete payment

7. Check: does browser redirect to `https://rebrew.in/checkout.html?success=true&order=<id>`?

8. `GET /payments/verify/<sessionId>` — verify server recorded the payment

9. `GET /orders` — verify order appears

### Expected Result

- `POST /cart/validate`: HTTP `200`, `shipping: 40`, `grandTotal: 189` (₹149 + ₹40)
- `POST /payments/create-checkout-session`: HTTP `201`, `data.sessionUrl` is a valid `https://checkout.stripe.com/...` URL
- Stripe Checkout page loads with correct line items and amounts in ₹
- After payment: redirect to success URL
- Webhook fires: `checkout.session.completed` visible in Stripe Dashboard → Webhooks
- Order in DB: `paymentStatus: "paid"`, `orderStatus: "confirmed"`, `stockReserved: true`
- Product stock decreased by ordered quantity
- `GET /orders`: new order appears at top
- Order confirmation email received

### Failure Indicators

- `✗` `data.sessionUrl` is `undefined` — `FRONTEND_URL` missing from `.env`
- `✗` Stripe Checkout shows wrong currency (not ₹) — `STRIPE_CURRENCY=inr` not set
- `✗` No redirect after payment — `success_url` broken
- `✗` Webhook not received in Stripe Dashboard — check Nginx webhook location, check `STRIPE_WEBHOOK_SECRET`
- `✗` Order still `paymentStatus: "pending"` after payment — webhook not processing; check `pm2 logs rebrew-api`
- `✗` Stock not decremented — `stockReserved` flag or `_decrementStock` broken
- `✗` `ProcessedEvent` duplicate error in logs — idempotency insert failing on new event

---

## C11 — Stripe Payment Failure

### Steps

1. Add item to cart, create new checkout session

2. In Stripe Checkout page, use decline card:  
   `4000 0000 0000 0002` (card declined)

3. Stripe shows decline message — do NOT complete payment

4. Let the session expire (or use `4000 0000 0000 0069` — expired card)

5. Check `GET /orders` for the pending order

### Expected Result

- Stripe shows `"Your card was declined"` or appropriate error
- No redirect to success URL
- Webhook `payment_intent.payment_failed` fires (visible in Stripe Dashboard)
- Pending order in DB changes to `paymentStatus: "failed"`, `orderStatus: "cancelled"`
- Stock NOT decremented (`stockReserved: false`)
- Cart NOT cleared (customer can try again)

### Failure Indicators

- `✗` Stock decremented on failed payment — critical inventory bug
- `✗` Order stays `"pending"` — webhook `payment_intent.payment_failed` handler not firing
- `✗` Cart cleared — cart should only clear on successful payment
- `✗` No entry in `ProcessedEvent` collection for failed-payment event

---

## C12 — View Orders

### Steps

1. `GET /orders` (auth required)

2. `GET /orders?status=confirmed`

3. `GET /orders/<orderId>` — a confirmed order

4. `GET /orders/<other_customer_order_id>` — attempt to access another user's order

### Expected Result

- `GET /orders`: paginated list of current user's orders only
- `GET /orders?status=confirmed`: only `orderStatus: "confirmed"` orders
- `GET /orders/<id>`: full order detail including items, address, totals
- Response does NOT include `adminNote` or `stockReserved` fields
- Accessing another user's order: HTTP `404` (not 403 — don't reveal existence)

### Failure Indicators

- `✗` Other users' orders visible — IDOR vulnerability (critical)
- `✗` `adminNote` visible in customer response — sensitive field leaked
- `✗` HTTP `500` instead of `404` on cross-user access — error handling broken

---

## C13 — Cancel Unpaid COD Order

### Steps

1. `POST /orders` with `paymentMethod: "cod"`
```json
{
  "shippingAddress": {
    "fullName": "Test Customer",
    "line1": "123 Test Street",
    "city": "Coimbatore",
    "state": "Tamil Nadu",
    "pincode": "641001",
    "phone": "9876543210"
  },
  "paymentMethod": "cod"
}
```

2. Note the order ID and `stockReserved` should be `false`

3. `PUT /orders/<orderId>/cancel`
```json
{ "reason": "Changed my mind" }
```

4. Try to cancel a **paid card order** (from C10)

### Expected Result

- COD order created: HTTP `201`, `paymentStatus: "pending"`, `orderStatus: "pending"`, `stockReserved: false` (stock NOT decremented at creation)
- Cart cleared after COD order created
- Cancel COD order: HTTP `200`, `"Order cancelled."`, `orderStatus: "cancelled"`
- Stock NOT changed (was never reserved — `_restoreStockForOrder` is a no-op when `stockReserved: false`)
- Attempt to cancel paid card order: HTTP `400` — `"Paid orders cannot be self-cancelled. Please contact support..."`

### Failure Indicators

- `✗` COD order decrements stock at creation — inventory bug (stock should not move until admin confirms)
- `✗` Cancelling a paid order succeeds — customer could cancel after payment without refund
- `✗` Stock incorrectly restored on COD cancel (when it was never decremented) — double-restore impossible due to `stockReserved: false` check, but verify stock count unchanged

---

## C14 — Contact Form

### Steps

1. `POST /contact`
```json
{
  "name": "Test User",
  "email": "testcustomer@rebrew.in",
  "message": "This is a test inquiry about wholesale pricing.",
  "enquiryType": "wholesale"
}
```

2. Submit same form 6 times rapidly (rate limit test)

3. Check admin inbox for notification

### Expected Result

- HTTP `201`
- `message: "Your message has been received. We'll be in touch within 24 hours."`
- Acknowledgement email sent to `testcustomer@rebrew.in`
- Admin notification sent to `ADMIN_EMAIL` with enquiry details
- 6th submission within 1 hour: HTTP `429` — `"Too many submissions. Please wait before trying again."`

### Failure Indicators

- `✗` No acknowledgement email — SMTP broken or `contactLimiter` blocking
- `✗` No admin notification — `ADMIN_EMAIL` not set in `.env`
- `✗` 6th submission succeeds — `contactLimiter` not working (check rate limit window)
- `✗` HTML injection in admin notification email (name field) — `xss-clean` middleware should sanitize

---

## C15 — Newsletter Signup

### Steps

1. `POST /newsletter`
```json
{
  "email": "newsletter@rebrew.in",
  "name": "Test Subscriber"
}
```

2. Repeat the same request

3. `POST /newsletter`
```json
{ "email": "invalid-email" }
```

### Expected Result

- HTTP `201` on first signup
- `message: "You're on the list. Welcome to the ReBrew circle."`
- Welcome email sent to `newsletter@rebrew.in`
- Second signup (duplicate): HTTP `200` (not `409`) — generic success response prevents email enumeration
- Invalid email: HTTP `422` — `"Please provide a valid email address"`

### Failure Indicators

- `✗` HTTP `409` on duplicate — email enumeration possible (should return `200`)
- `✗` No welcome email — SMTP or template broken
- `✗` Invalid email passes — validator not running

---

---

# ADMIN FLOWS

*All admin requests require an admin-role JWT. Register an admin user directly in MongoDB: `db.users.updateOne({ email: "admin@rebrew.in" }, { $set: { role: "admin" } })` then login.*

---

## A1 — Admin Login

### Steps

1. Set admin role in MongoDB Atlas → Collections → users → find admin user → Edit → set `role: "admin"`

2. `POST /auth/login`
```json
{
  "email": "admin@rebrew.in",
  "password": "AdminPass123"
}
```

3. Save `accessToken` — this is the admin token for all A-flows

4. `GET /admin/dashboard`  
   Header: `Authorization: Bearer <admin_token>`

### Expected Result

- HTTP `200` on login
- `data.user.role: "admin"`
- `GET /admin/dashboard` HTTP `200` with stats: `users`, `orders`, `revenue`, `products`

### Failure Indicators

- `✗` HTTP `403` on dashboard — role not set correctly in DB
- `✗` HTTP `401` — token expired or not sent
- `✗` Dashboard `revenue.total` is `0` when paid orders exist — aggregation pipeline broken

---

## A2 — Create Product

### Steps

1. `POST /products`  
   Auth: admin token  
   Content-Type: `multipart/form-data`

   Fields:
   ```
   name: ReBrew Ginger
   description: A sharp, warming fermented ginger brew with earthy depth
   flavor: ginger
   price: 149
   stock: 100
   sku: RB-GINGER-001
   ingredients[0][name]: Fresh Ginger
   ingredients[0][description]: Wild-harvested from Coorg
   ```
   File: attach a JPEG image as `images`

2. `GET /products/<new_product_id>` to verify creation

### Expected Result

- HTTP `201`
- `"Product created successfully."`
- `data.product.slug` auto-generated: `"rebrew-ginger"`
- `data.product.images[0].url` is a Cloudinary URL (starts with `https://res.cloudinary.com/`)
- `data.product.images[0].isPrimary: true` (first image is primary)
- `data.product.active: true` (default)
- Product retrievable by slug: `GET /products/rebrew-ginger`

### Failure Indicators

- `✗` HTTP `403` — token not admin role
- `✗` HTTP `500` — Cloudinary credentials wrong; check `CLOUDINARY_API_KEY`
- `✗` `images` array empty — multer not processing files; check `multipart/form-data` content type
- `✗` Slug not generated — `slugify` pre-save hook not running
- `✗` Non-image file accepted (test with a `.txt` file) — fileFilter should return HTTP `400`

---

## A3 — Upload Product Images

### Steps

1. `PUT /products/<product_id>`  
   Auth: admin token  
   Content-Type: `multipart/form-data`  
   File: attach a PNG image as `images`

2. Try uploading a `.pdf` file as `images`

3. Try uploading a 6MB JPEG

### Expected Result

- Image upload: HTTP `200`, new image added to `data.product.images` array, Cloudinary URL present
- PDF upload: HTTP `400` — `"Only JPEG, PNG, and WebP images are allowed"`
- 6MB file: HTTP `413` — `"File size exceeds the 5MB limit"` (or Nginx 413 if limit hit there first)

### Failure Indicators

- `✗` PDF upload succeeds — MIME fileFilter not working
- `✗` Old images deleted on PUT (should accumulate, not replace)
- `✗` `publicId` missing from new image — Cloudinary deletion would fail later
- `✗` 6MB file causes `PayloadTooLargeError` without friendly message — error middleware not catching MulterError

---

## A4 — Update Stock

### Steps

1. Note current stock of a product (e.g. `stock: 100`)

2. `PUT /products/<product_id>/stock`  
   Auth: admin token
```json
{
  "stock": 50,
  "operation": "set"
}
```

3. Repeat with `"operation": "increment"` and `"stock": 10`

4. Repeat with `"operation": "decrement"` and `"stock": 200` (more than current stock)

### Expected Result

- `set` to 50: `data.stock: 50`
- `increment` by 10: `data.stock: 60`
- `decrement` by 200: stock floors at `0` (not negative) — `Math.max(0, 60 - 200) = 0`

### Failure Indicators

- `✗` Negative stock after oversized decrement — floor not applied in `updateStock`
- `✗` HTTP `422` on valid operation — validator rejecting `"operation"` enum value

---

## A5 — Create Event

### Steps

1. `POST /events`  
   Auth: admin token  
   Content-Type: `multipart/form-data`

   Fields:
   ```
   title: ReBrew Pop-Up — Coimbatore
   date: 2025-12-15T10:00:00.000Z
   location[venue]: Brookefields Mall
   location[city]: Coimbatore
   eventType: popup
   description: Come taste the full range live.
   isFeatured: true
   ```
   File: attach an event image as `image`

2. `GET /events` — verify event appears

3. `GET /events?period=upcoming` — verify future event appears

### Expected Result

- HTTP `201`
- `data.event.slug` auto-generated: `"rebrew-pop-up-coimbatore"`
- `data.event.image.url` is a Cloudinary URL with event transformation (1920×1080)
- `GET /events?period=upcoming` includes the new event

### Failure Indicators

- `✗` Slug collision if title matches existing event — appended timestamp, not error
- `✗` Image transformed to 1200×1200 instead of 1920×1080 — using wrong CloudinaryStorage (productStorage instead of eventStorage)
- `✗` `GET /events/admin/all` returns `404` — route ordering bug (must come before `/:id`)

---

## A6 — Update Event

### Steps

1. `PUT /events/<event_id>`  
   Auth: admin token
```json
{
  "title": "ReBrew Pop-Up — Coimbatore [Updated]",
  "isPublished": false
}
```

2. `GET /events` — verify unpublished event does NOT appear (public route)

3. `GET /events/admin/all` — verify event DOES appear (admin route)

### Expected Result

- HTTP `200`, updated title in response
- Public `GET /events` does not include `isPublished: false` event
- `GET /events/admin/all` includes it

### Failure Indicators

- `✗` Unpublished event appears in public list — `isPublished: true` filter broken
- `✗` HTTP `404` on `GET /events/admin/all` — route ordering bug (confirmed fixed, but verify)

---

## A7 — View Orders (Admin)

### Steps

1. `GET /orders/admin/all`  
   Auth: admin token

2. `GET /orders/admin/all?status=confirmed`

3. `GET /orders/admin/all?search=RB-` (search by order number prefix)

4. `GET /orders/admin/stats`

5. `GET /orders/admin/<orderId>`

### Expected Result

- `GET /orders/admin/all`: all orders, `user` field populated with name/email/phone
- Status filter: only `confirmed` orders
- Search: orders whose `orderNumber` matches pattern
- Stats: `totalOrders`, `totalRevenue`, `todayOrders` present
- Single order: full detail including `statusHistory`, `adminNote`, `stockReserved` visible to admin

### Failure Indicators

- `✗` HTTP `404` on `/orders/admin/all` — route ordering bug (admin routes must precede `/:id`)
- `✗` Customer orders visible without user population — `populate('user', ...)` broken
- `✗` `GET /orders/admin/all` returns customer's own orders only — auth middleware applying user scope to admin route

---

## A8 — Update Order Status

### Steps

1. Take a COD order in `"pending"` status

2. `PUT /orders/admin/<orderId>`  
   Auth: admin token
```json
{ "orderStatus": "confirmed" }
```

3. Immediately check product stock — should have decreased

4. `PUT /orders/admin/<orderId>`
```json
{ "orderStatus": "processing" }
```

5. `PUT /orders/admin/<orderId>`
```json
{ "orderStatus": "pending" }
```
(invalid reverse transition)

6. Try to set `paymentStatus: "paid"` manually:
```json
{ "paymentStatus": "paid" }
```

### Expected Result

- Confirm COD order: HTTP `200`, `orderStatus: "confirmed"`, stock decremented by ordered quantities, `stockReserved: true` in DB
- Processing: HTTP `200`, `orderStatus: "processing"`
- Reverse to pending: HTTP `400` — `"Cannot transition order from 'processing' to 'pending'"`
- Set paid manually: HTTP `400` — `"Payment status cannot be manually set to 'paid'..."`
- `statusHistory` has exactly ONE new entry per transition (not duplicates)

### Failure Indicators

- `✗` Stock not decremented when COD order confirmed — `_decrementStockForOrder` not called or `stockAction` not set to `"decrement"`
- `✗` Duplicate `statusHistory` entries — double-save bug (confirmed fixed, verify)
- `✗` Invalid transition accepted — `validTransitions` map not enforced
- `✗` `paymentStatus: "paid"` accepted — H1 fix not working

---

## A9 — Refund Order

### Steps

1. Take a paid Stripe order (from C10) with `paymentStatus: "paid"`

2. Note current stock of ordered product

3. `POST /payments/refund/<orderId>`  
   Auth: admin token
```json
{
  "reason": "requested_by_customer"
}
```

4. Check Stripe Dashboard — refund should appear

5. Wait for `charge.refunded` webhook, then check:
   - Order `paymentStatus`
   - Product stock

6. Try to refund same order again

### Expected Result

- HTTP `200`, `data.refundId` starts with `re_` (Stripe refund ID)
- Stripe Dashboard → Payments → find original charge → Refunds tab shows the refund
- After `charge.refunded` webhook: `paymentStatus: "refunded"`, `refundAmount` = full order total
- Stock restored — product stock back to pre-order level
- Second refund attempt: HTTP `400` — `"Order is not in a paid state."`
- `stockReserved: false` in DB after restore

### Failure Indicators

- `✗` HTTP `502` — Stripe refund failed; check `STRIPE_SECRET_KEY` is live mode and valid
- `✗` Stock not restored — `_restoreStock` not called from `handleRefund` webhook
- `✗` Double stock restore if both `adminRefundOrder` AND `charge.refunded` webhook run — `stockReserved` flag prevents this; verify `stockReserved` is `false` after first restore
- `✗` Second refund succeeds — paymentStatus guard not working

---

## A10 — Moderate Reviews

### Steps

1. `GET /admin/reviews` — should list all reviews including unapproved

2. `GET /admin/reviews?isApproved=false`

3. Take an unapproved review ID

4. `PUT /admin/reviews/<reviewId>`  
   Auth: admin token
```json
{ "isApproved": true }
```

5. Check `GET /products/<productId>` — `averageRating` should update

6. `DELETE /admin/reviews/<reviewId>`

7. Check `averageRating` on the product again

### Expected Result

- Review list includes unapproved reviews (admin sees all)
- Approve: HTTP `200`, `isApproved: true` in response
- `averageRating` on product updates after approval (post-save hook fires)
- Delete: HTTP `200`, `"Review deleted."`
- `averageRating` recalculated after deletion (post-findOneAndDelete hook fires)

### Failure Indicators

- `✗` `averageRating` unchanged after approval — `post('save')` hook not running or aggregation failing
- `✗` `averageRating` unchanged after deletion — `post('findOneAndDelete')` hook not firing (confirmed fixed in models/index.js, verify)
- `✗` HTTP `404` on DELETE — review ID already invalid

---

---

# PRE-LAUNCH TEST CHECKLIST

Execute every item below on the live production environment before announcing to customers.

---

## INFRASTRUCTURE

- [ ] `curl https://api.rebrew.in/health` → `{"status":"ok","service":"rebrew-api",...}` — no `"env"` field
- [ ] `curl -I http://rebrew.in` → `301` redirect to `https://rebrew.in`
- [ ] `curl -I http://api.rebrew.in` → `301` redirect to `https://api.rebrew.in`
- [ ] `curl -I https://www.rebrew.in` → `301` redirect to `https://rebrew.in`
- [ ] `pm2 status` → `rebrew-api` is `online`, not `errored`
- [ ] `pm2 logs rebrew-api --lines 20` → no `ERROR` lines
- [ ] SSL Labs test on `api.rebrew.in` → Grade A (https://www.ssllabs.com/ssltest/)
- [ ] Security headers test → Grade A or B (https://securityheaders.com)
- [ ] `sudo reboot` → after 2 min, `pm2 status` shows `online` without manual start

---

## AUTHENTICATION

- [ ] `POST /auth/register` → `201`, welcome email received
- [ ] `POST /auth/login` → `200`, token returned
- [ ] `POST /auth/logout` (no token) → `401` (not `200`)
- [ ] `POST /auth/logout` (valid token) → `200`, cookies cleared
- [ ] `POST /auth/forgot-password` (real email) → `200`, reset email received
- [ ] `POST /auth/forgot-password` (fake email) → `200` (same message, no email sent)
- [ ] Password reset token used → `200`
- [ ] Same token reused → `400`
- [ ] Login with old password after reset → `401`
- [ ] Login with new password after reset → `200`

---

## PRODUCTS

- [ ] `GET /products` → products listed, no `stripeProductId` field in response
- [ ] `GET /products?flavor=grape` → only grape products
- [ ] `GET /products?search=ginger` → ginger products matched
- [ ] `GET /products/<slug>` → single product by slug
- [ ] `GET /products/<objectId>` → same product by ID
- [ ] `GET /products/nonexistent-slug` → `404`
- [ ] `GET /products/featured` → only `isFeatured: true` products

---

## CART

- [ ] `POST /cart/add` (unauthenticated) → `401`
- [ ] `POST /cart/add` (authenticated, valid product) → `201`, price from DB not client
- [ ] `POST /cart/add` (same product again) → quantity accumulates
- [ ] `POST /cart/add` with `quantity: 0` → `422`
- [ ] `PUT /cart/update` with `quantity: 0` → item removed
- [ ] `DELETE /cart/clear` → empty cart
- [ ] `POST /cart/validate` → totals correct (₹40 shipping if total < ₹499)
- [ ] `POST /cart/validate` with total ≥ ₹499 → shipping is `0`

---

## CHECKOUT AND PAYMENT

- [ ] `POST /payments/create-checkout-session` (empty cart) → `400`
- [ ] `POST /payments/create-checkout-session` (valid cart) → `201`, `sessionUrl` is valid Stripe URL
- [ ] Stripe Checkout page loads with correct items and ₹ amounts
- [ ] Complete payment with test card `4242 4242 4242 4242` → redirect to success URL
- [ ] Webhook `checkout.session.completed` received in Stripe Dashboard
- [ ] Order `paymentStatus: "paid"`, `orderStatus: "confirmed"` in DB
- [ ] Stock decremented by ordered quantity
- [ ] Cart cleared after successful payment
- [ ] Order confirmation email received
- [ ] `GET /payments/verify/<sessionId>` → `200`, payment verified
- [ ] Declined card `4000 0000 0000 0002` → no stock change, order stays pending/fails
- [ ] `PUT /orders/<paidOrderId>/cancel` (customer) → `400` (cannot self-cancel paid order)

---

## ORDERS

- [ ] COD order `POST /orders` → `201`, `stockReserved: false` in DB
- [ ] COD order stock NOT decremented at creation
- [ ] Cancel COD order → `200`, stock unchanged
- [ ] `GET /orders` → only current user's orders
- [ ] `GET /orders/<other_user_order_id>` → `404`
- [ ] Admin confirms COD order → stock decremented, `stockReserved: true`

---

## ADMIN

- [ ] `GET /admin/dashboard` (customer token) → `403`
- [ ] `GET /admin/dashboard` (admin token) → `200` with stats
- [ ] `POST /products` (customer token) → `403`
- [ ] `POST /products` (admin, with image) → `201`, Cloudinary URL in response
- [ ] `PUT /products/<id>/stock` with `set` → stock updated correctly
- [ ] `PUT /products/<id>/stock` with `decrement` > stock → stock floors at `0`, not negative
- [ ] Admin set `paymentStatus: "paid"` manually → `400` blocked
- [ ] Invalid order status transition → `400`
- [ ] Duplicate `statusHistory` entries after COD confirm → none (exactly 1 entry per transition)
- [ ] `GET /orders/admin/all` → `200` (not `404` from route ordering bug)
- [ ] `POST /payments/refund/<paidOrderId>` → `200`, `re_` refund ID
- [ ] Stock restored after full refund
- [ ] Second refund attempt → `400`
- [ ] Approve review → `averageRating` updates on product
- [ ] Delete review → `averageRating` recalculates

---

## FORMS

- [ ] `POST /contact` → `201`, acknowledgement email received
- [ ] `POST /contact` 6× in 1 hour → 6th request returns `429`
- [ ] `POST /newsletter` → `201`, welcome email received
- [ ] `POST /newsletter` duplicate email → `200` (not `409`)
- [ ] `POST /newsletter` invalid email → `422`

---

## SECURITY SPOT-CHECKS

- [ ] `GET /products?search=<script>alert(1)</script>` → `200` (handled), no XSS in response
- [ ] `GET /products?search=((a+)+)b` (ReDoS) → `200`, fast response (escaped regex)
- [ ] `POST /auth/login` with `{ "email": { "$gt": "" }, "password": "x" }` → `401` or `422` (not `200`)
- [ ] `GET /admin/users` (customer token) → `403`
- [ ] `PUT /orders/admin/<id>` (customer token) → `403`
- [ ] File upload with `.html` file as image → `400`
- [ ] Request with `Content-Length: 999999999` and no body → Nginx `413` or Node `413`

---

**Sign off when all items above are checked. Then launch.**
