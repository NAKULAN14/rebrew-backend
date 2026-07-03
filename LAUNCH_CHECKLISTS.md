# ReBrew — Production Launch Checklists

---

## MONGODB ATLAS PRODUCTION CHECKLIST

Complete every item before pointing the app at Atlas.

### Cluster Configuration
- [ ] **Tier:** M10 or higher for production (M0 free tier has connection limits and no dedicated resources — do not use for real orders)
- [ ] **Region:** Mumbai (ap-south-1) — lowest latency from Coimbatore
- [ ] **MongoDB version:** 7.0+
- [ ] **Backups:** Enable continuous cloud backups (Cluster → Backup tab)
- [ ] **Backup retention:** Minimum 7 days

### Network Access
- [ ] **IP Allowlist:** Add your VPS IP address only. Do NOT set 0.0.0.0/0 (allows all IPs)
  - Go to: Network Access → Add IP Address → Enter VPS IP
- [ ] Remove any 0.0.0.0/0 entries if they exist from development

### Database User
- [ ] Create a dedicated production user (not the admin user used during setup)
  - Database Access → Add New Database User
  - Username: `rebrew_prod`
  - Password: generate with strong random (32+ chars, no special chars that break connection strings)
  - Role: `readWrite` on the `rebrew` database only (not `atlasAdmin`)
- [ ] Confirm the connection string uses this user, not the admin account

### Connection String
- [ ] Test the production connection string locally before deploying:
  ```bash
  MONGO_URI="your-connection-string" node -e "
    require('dotenv').config();
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGO_URI).then(() => {
      console.log('Connected OK');
      process.exit(0);
    });
  "
  ```
- [ ] Confirm the database name in the URI is `rebrew` (not `test`)
  - Correct: `...mongodb.net/rebrew?retryWrites=true&w=majority`
  - Wrong:   `...mongodb.net/test?...`

### Performance
- [ ] Go to: Atlas → Cluster → Performance Advisor after first week of traffic
- [ ] Create any missing indexes it recommends
- [ ] Enable: Cluster → Monitoring → Real Time to watch query patterns on launch day

### Alerts
- [ ] Set up Atlas alerts:
  - Connections above 80% of limit → email admin
  - Disk space above 80% → email admin
  - Replication lag above 10s → email admin
  - (Atlas → Integrations → Alert Settings)

---

## STRIPE PRODUCTION CHECKLIST

### Keys and Mode
- [ ] Confirm you are using **live mode** keys (`sk_live_...`, `pk_live_...`), NOT test mode keys
  - Stripe Dashboard → Developers → API Keys → toggle to "Live"
- [ ] `STRIPE_SECRET_KEY` in `.env` starts with `sk_live_`
- [ ] `STRIPE_PUBLISHABLE_KEY` in `.env` starts with `pk_live_`
- [ ] `STRIPE_CURRENCY=inr` is set

### Webhook
- [ ] Webhook endpoint created at: `https://api.rebrew.in/api/v1/payments/webhook`
- [ ] These events are selected:
  - [x] `checkout.session.completed`
  - [x] `checkout.session.expired`
  - [x] `payment_intent.payment_failed`
  - [x] `charge.refunded`
  - [x] `charge.dispute.created`
- [ ] `STRIPE_WEBHOOK_SECRET` in `.env` is the signing secret for the **live** webhook endpoint (starts with `whsec_`)
- [ ] Webhook shows as **Enabled** in Stripe Dashboard

### Test a Live Payment
- [ ] Make a real ₹1 test purchase using a real card before launch
- [ ] Confirm `checkout.session.completed` webhook fires and is received (Stripe Dashboard → Webhooks → endpoint → Recent deliveries)
- [ ] Confirm order status changes to `confirmed` in the database
- [ ] Confirm stock decrements correctly
- [ ] Confirm order confirmation email is received
- [ ] Issue a refund from the admin panel
- [ ] Confirm `charge.refunded` webhook fires
- [ ] Confirm stock is restored
- [ ] Confirm `paymentStatus` changes to `refunded`

### Business Settings
- [ ] Stripe Dashboard → Settings → Business settings:
  - Business name: ReBrew
  - Business address: Coimbatore, Tamil Nadu, India
  - Support email: hello@rebrew.in
  - Support phone: set your number
- [ ] Statement descriptor set (what appears on customer bank statements): `REBREW`
- [ ] Enable Indian card payment methods (Stripe Dashboard → Settings → Payment methods)

### Compliance (India-specific)
- [ ] If orders exceed ₹2 lakh / month, GST registration and GST invoice flow is legally required
- [ ] Stripe India requires a business PAN — confirm it is set in Stripe Dashboard → Settings → Tax settings

---

## ENVIRONMENT VARIABLE CHECKLIST

Create `/var/www/rebrew-backend/.env` with every variable below.
Values marked `[GENERATE]` must be generated — do not use example values.

### Server
```
NODE_ENV=production
PORT=5000
API_VERSION=v1
```

### MongoDB
```
MONGO_URI=mongodb+srv://rebrew_prod:<password>@cluster0.xxxxx.mongodb.net/rebrew?retryWrites=true&w=majority
```
- [ ] Uses the `rebrew_prod` user, not admin
- [ ] Database name is `rebrew`, not `test`
- [ ] Connection tested from VPS

### JWT — [GENERATE both values]
Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Run this command **twice** — once for each secret. They must be different.

```
JWT_SECRET=<64-byte hex string — GENERATE>
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=<different 64-byte hex string — GENERATE>
JWT_REFRESH_EXPIRES_IN=30d
JWT_COOKIE_EXPIRES_IN=7
```
- [ ] `JWT_SECRET` is at least 64 characters
- [ ] `JWT_REFRESH_SECRET` is different from `JWT_SECRET`

### bcrypt
```
BCRYPT_SALT_ROUNDS=12
```

### Stripe
```
STRIPE_SECRET_KEY=sk_live_<your live secret key>
STRIPE_PUBLISHABLE_KEY=pk_live_<your live publishable key>
STRIPE_WEBHOOK_SECRET=whsec_<signing secret from webhook endpoint>
STRIPE_CURRENCY=inr
```
- [ ] All three Stripe values are for **live mode**, not test mode

### Cloudinary
```
CLOUDINARY_CLOUD_NAME=<your cloud name>
CLOUDINARY_API_KEY=<your api key>
CLOUDINARY_API_SECRET=<your api secret>
CLOUDINARY_FOLDER=rebrew
```
- [ ] Log in to cloudinary.com and confirm these values
- [ ] The `rebrew` folder exists (or will be auto-created on first upload)

### Email (Hostinger SMTP)
```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=hello@rebrew.in
SMTP_PASS=<your email password>
EMAIL_FROM=hello@rebrew.in
EMAIL_FROM_NAME=ReBrew
```
- [ ] SMTP credentials tested by sending a test email:
  ```bash
  node -e "
    require('dotenv').config();
    const nodemailer = require('nodemailer');
    nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: 465, secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    }).sendMail({
      from: process.env.EMAIL_FROM, to: process.env.ADMIN_EMAIL,
      subject: 'ReBrew SMTP Test', text: 'SMTP is working.'
    }).then(() => console.log('OK')).catch(console.error);
  "
  ```

### CORS and URLs
```
ALLOWED_ORIGINS=https://rebrew.in,https://www.rebrew.in
FRONTEND_URL=https://rebrew.in
BACKEND_URL=https://api.rebrew.in
```
- [ ] `ALLOWED_ORIGINS` does NOT include localhost
- [ ] No trailing slashes on any URL

### Admin
```
ADMIN_EMAIL=admin@rebrew.in
```

### Rate limiting (optional — defaults are production-safe)
```
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX=10
```

---

## FINAL PRE-LAUNCH VERIFICATION

Run these checks on the live server before announcing to customers:

### Application
- [ ] `pm2 status` shows `rebrew-api` as `online`
- [ ] `pm2 logs rebrew-api --lines 50` shows no errors
- [ ] `curl https://api.rebrew.in/health` returns `{"status":"ok",...}`

### SSL
- [ ] `https://rebrew.in` loads with valid padlock
- [ ] `https://api.rebrew.in/health` loads with valid padlock
- [ ] `http://rebrew.in` redirects to `https://rebrew.in`
- [ ] SSL Labs test: https://www.ssllabs.com/ssltest/ → both domains should score A

### Security headers
- [ ] https://securityheaders.com → enter `https://api.rebrew.in` → should score A or B

### Stripe
- [ ] Real ₹1 payment completes end to end
- [ ] Webhook received in Stripe Dashboard → endpoint → Recent deliveries

### Email
- [ ] Register a new account → welcome email received
- [ ] Request password reset → reset email received with working link

### MongoDB Atlas
- [ ] Atlas dashboard shows active connections after app is running
- [ ] Real-time performance shows queries executing

### PM2 reboot persistence
```bash
sudo reboot
# After 2 minutes:
ssh rebrew@<ip>
pm2 status  # Should show rebrew-api online without manual start
```
