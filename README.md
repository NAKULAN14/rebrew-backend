# REBREW Backend API

Production-ready REST API for the ReBrew premium fermented fruit soda brand.

---

## Stack

| Layer       | Technology                    |
|-------------|-------------------------------|
| Runtime     | Node.js 18+                   |
| Framework   | Express.js 4                  |
| Database    | MongoDB Atlas + Mongoose 8    |
| Auth        | JWT (access + refresh tokens) |
| Passwords   | bcryptjs (12 salt rounds)     |
| Payments    | Stripe Checkout + Webhooks    |
| Images      | Cloudinary                    |
| Email       | Nodemailer (Hostinger SMTP)   |
| Validation  | express-validator             |
| Logging     | Winston                       |
| Security    | Helmet, CORS, mongoSanitize, xss-clean, hpp, rate-limit |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env
# Fill in all values in .env

# 3. Development
npm run dev

# 4. Production
npm start
```

---

## Project Structure

```
rebrew-backend/
├── config/
│   ├── database.js       # MongoDB Atlas connection + retry
│   ├── cloudinary.js     # Cloudinary + Multer upload config
│   └── stripe.js         # Stripe client
├── controllers/
│   ├── authController.js
│   ├── productController.js
│   ├── cartController.js
│   ├── orderController.js
│   ├── paymentController.js
│   ├── contactController.js
│   ├── newsletterController.js
│   ├── vendorController.js
│   ├── eventController.js
│   └── adminController.js
├── middleware/
│   ├── auth.js           # JWT protect, authorize, role guards
│   ├── error.js          # Centralized error handler + 404
│   └── rateLimiter.js    # API, auth, payment, contact limiters
├── models/
│   ├── User.js
│   ├── Product.js
│   ├── Order.js
│   └── index.js          # Cart, Contact, Newsletter, Vendor, Event, Review
├── routes/
│   ├── authRoutes.js
│   ├── productRoutes.js
│   ├── cartRoutes.js
│   ├── orderRoutes.js
│   ├── paymentRoutes.js
│   ├── contactRoutes.js
│   ├── newsletterRoutes.js
│   ├── vendorRoutes.js
│   ├── eventRoutes.js
│   └── adminRoutes.js
├── utils/
│   ├── logger.js         # Winston structured logging
│   ├── apiResponse.js    # sendSuccess, sendError, sendPaginated, AppError
│   ├── jwtUtils.js       # Token sign/verify/cookie helpers
│   └── email.js          # Nodemailer + HTML templates
├── validators/
│   └── index.js          # All express-validator rule sets
├── uploads/              # Temp upload dir (Cloudinary uploads bypass this)
├── logs/                 # Winston log files (production)
├── app.js                # Express app, middleware, routes
├── server.js             # HTTP server, graceful shutdown
├── .env.example
└── package.json
```

---

## API Reference

**Base URL:** `https://api.rebrew.in/api/v1`

All responses follow this shape:
```json
{
  "success": true,
  "message": "Human-readable message",
  "data": {},
  "meta": { "page": 1, "limit": 12, "total": 50, "totalPages": 5 }
}
```

---

### Auth  `/auth`

| Method | Route                    | Auth     | Description                   |
|--------|--------------------------|----------|-------------------------------|
| POST   | `/auth/register`         | Public   | Register new customer account |
| POST   | `/auth/login`            | Public   | Login, receive JWT             |
| POST   | `/auth/logout`           | Public   | Clear cookies, invalidate      |
| POST   | `/auth/refresh-token`    | Public   | Refresh access token           |
| POST   | `/auth/forgot-password`  | Public   | Send password reset email      |
| POST   | `/auth/reset-password`   | Public   | Reset password via token       |
| GET    | `/auth/profile`          | Auth     | Get current user profile       |
| PUT    | `/auth/profile`          | Auth     | Update name/phone              |
| PUT    | `/auth/update-password`  | Auth     | Change password                |
| POST   | `/auth/addresses`        | Auth     | Add saved address              |
| DELETE | `/auth/addresses/:id`    | Auth     | Remove saved address           |

**Rate limits:** 10 login/register attempts per 15 min per IP. 3 password resets per hour.

---

### Products  `/products`

| Method | Route                           | Auth     | Description              |
|--------|---------------------------------|----------|--------------------------|
| GET    | `/products`                     | Public   | List products (paginated)|
| GET    | `/products/featured`            | Public   | Featured products        |
| GET    | `/products/:id`                 | Public   | Single product by ID/slug|
| POST   | `/products`                     | Admin    | Create product           |
| PUT    | `/products/:id`                 | Admin    | Update product           |
| PUT    | `/products/:id/stock`           | Admin    | Update stock             |
| DELETE | `/products/:id/images/:imageId` | Admin    | Delete one image         |
| DELETE | `/products/:id`                 | Admin    | Soft-delete product      |

**Query params for GET /products:**
`?page=1&limit=12&flavor=grape&search=pineapple&sort=popular&minPrice=100&maxPrice=200&featured=true`

---

### Cart  `/cart`

| Method | Route            | Auth | Description             |
|--------|------------------|------|-------------------------|
| GET    | `/cart`          | Auth | Get cart (validates live)|
| POST   | `/cart/add`      | Auth | Add item to cart        |
| PUT    | `/cart/update`   | Auth | Update item quantity    |
| DELETE | `/cart/remove`   | Auth | Remove specific item    |
| DELETE | `/cart/clear`    | Auth | Empty cart              |
| POST   | `/cart/validate` | Auth | Validate before checkout|

> **Security:** Server always re-validates prices from DB. Frontend prices are never trusted.

---

### Orders  `/orders`

| Method | Route                  | Auth     | Description                  |
|--------|------------------------|----------|------------------------------|
| POST   | `/orders`              | Auth     | Create order (COD flow)      |
| GET    | `/orders`              | Auth     | My order history             |
| GET    | `/orders/:id`          | Auth     | Single order (own only)      |
| PUT    | `/orders/:id/cancel`   | Auth     | Cancel order (if cancellable)|
| GET    | `/orders/admin/all`    | Admin    | All orders with filters      |
| GET    | `/orders/admin/stats`  | Admin    | Order statistics             |
| GET    | `/orders/admin/:id`    | Admin    | Any order (full detail)      |
| PUT    | `/orders/admin/:id`    | Admin    | Update status/tracking       |

---

### Payments  `/payments`

| Method | Route                               | Auth   | Description                     |
|--------|-------------------------------------|--------|---------------------------------|
| POST   | `/payments/create-checkout-session` | Auth   | Create Stripe Checkout session  |
| POST   | `/payments/webhook`                 | Public | Stripe webhook (signature-verified) |
| GET    | `/payments/verify/:sessionId`       | Auth   | Verify completed payment        |
| POST   | `/payments/refund/:orderId`         | Admin  | Issue Stripe refund             |

> **Security:** Webhook verifies Stripe signature. Payment status only updated via webhook — never via frontend.

---

### Contact  `/contact`

| Method | Route             | Auth  | Description             |
|--------|-------------------|-------|-------------------------|
| POST   | `/contact`        | Public| Submit contact enquiry  |
| GET    | `/contact`        | Admin | List all contacts       |
| GET    | `/contact/:id`    | Admin | Single contact          |
| PUT    | `/contact/:id`    | Admin | Update status/note      |
| DELETE | `/contact/:id`    | Admin | Delete contact          |

---

### Newsletter  `/newsletter`

| Method | Route                        | Auth  | Description           |
|--------|------------------------------|-------|-----------------------|
| POST   | `/newsletter`                | Public| Subscribe             |
| POST   | `/newsletter/unsubscribe`    | Public| Unsubscribe via token |
| GET    | `/newsletter`                | Admin | List subscribers      |
| POST   | `/newsletter/broadcast`      | Admin | Send broadcast email  |
| DELETE | `/newsletter/:id`            | Admin | Remove subscriber     |

---

### Vendor  `/vendor`

| Method | Route              | Auth  | Description               |
|--------|--------------------|-------|---------------------------|
| POST   | `/vendor/apply`    | Public| Submit wholesale enquiry  |
| GET    | `/vendor`          | Admin | List all applications     |
| GET    | `/vendor/:id`      | Admin | Single application        |
| PUT    | `/vendor/:id`      | Admin | Update status/assign      |
| DELETE | `/vendor/:id`      | Admin | Delete application        |

---

### Events  `/events`

| Method | Route              | Auth  | Description              |
|--------|--------------------|-------|--------------------------|
| GET    | `/events`          | Public| Upcoming events (default)|
| GET    | `/events/:id`      | Public| Single event             |
| GET    | `/events/admin/all`| Admin | All events (incl. drafts)|
| POST   | `/events`          | Admin | Create event             |
| PUT    | `/events/:id`      | Admin | Update event             |
| DELETE | `/events/:id`      | Admin | Delete event             |

`?period=upcoming|past|all&eventType=popup|festival|tasting|market`

---

### Admin  `/admin`

| Method | Route                       | Auth  | Description              |
|--------|-----------------------------|-------|--------------------------|
| GET    | `/admin/dashboard`          | Admin | Dashboard stats          |
| GET    | `/admin/analytics/sales`    | Admin | Sales analytics          |
| GET    | `/admin/analytics/inventory`| Admin | Inventory analytics      |
| GET    | `/admin/users`              | Admin | All users                |
| GET    | `/admin/users/:id`          | Admin | User + order history     |
| PUT    | `/admin/users/:id`          | Admin | Update role/status       |
| DELETE | `/admin/users/:id`          | Admin | Deactivate user          |
| GET    | `/admin/reviews`            | Admin | All reviews              |
| PUT    | `/admin/reviews/:id`        | Admin | Approve/reject review    |
| DELETE | `/admin/reviews/:id`        | Admin | Delete review            |

---

## Authentication

Pass the JWT access token in one of two ways:

```
Authorization: Bearer <access_token>
```
or via the `token` HTTP-only cookie (set automatically on login).

Access tokens expire in 7 days. Use `POST /auth/refresh-token` with the `refreshToken` cookie or body to get a new access token.

---

## Security Measures

| Threat                  | Mitigation                                          |
|-------------------------|-----------------------------------------------------|
| Brute force login       | 10 attempts per 15 min per IP (authLimiter)         |
| API abuse               | 100 req/15 min per IP (apiLimiter) + slowDown        |
| MongoDB injection       | express-mongo-sanitize (strips $, .)                |
| XSS                     | xss-clean on all request bodies                     |
| HTTP param pollution    | hpp middleware                                       |
| Clickjacking/MIME sniff | Helmet security headers                             |
| CSRF                    | SameSite=Strict cookies + CORS whitelist            |
| Price manipulation      | All prices fetched from DB on every cart/order op   |
| Payment fraud           | Order status only updated via Stripe webhook        |
| Webhook spoofing        | Stripe signature verified on raw body               |
| Password exposure       | bcrypt (12 rounds), select: false on password field |
| Token leakage           | HTTP-only, Secure, SameSite cookies                 |
| Email enumeration       | Generic messages on forgot-password                 |
| Oversized payloads      | JSON body limit: 10kb                               |
| HSTS                    | 1-year max-age with preload                         |

---

## Stripe Webhook Setup

1. Install Stripe CLI: `stripe listen --forward-to localhost:5000/api/v1/payments/webhook`
2. In production: Add endpoint in Stripe Dashboard → Developers → Webhooks
3. Set `STRIPE_WEBHOOK_SECRET` to the signing secret shown in Dashboard
4. Events to enable: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`

---

## Deployment (Hostinger VPS)

```bash
# 1. Install Node.js 18+ via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18 && nvm use 18

# 2. Install PM2
npm install -g pm2

# 3. Clone repo and install deps
git clone <repo> rebrew-backend && cd rebrew-backend
npm install --production

# 4. Set environment
cp .env.example .env && nano .env

# 5. Start with PM2
pm2 start server.js --name rebrew-api --instances max --exec-mode cluster
pm2 save && pm2 startup

# 6. Nginx reverse proxy
# proxy_pass http://127.0.0.1:5000;
# Add SSL via Certbot: certbot --nginx -d api.rebrew.in
```

---

## Promo Codes (Demo)

| Code        | Discount  |
|-------------|-----------|
| `REBREW10`  | 10% off   |
| `FIRST50`   | ₹50 off   |

---

*ReBrew Backend — Production API v1 · Coimbatore, India*
