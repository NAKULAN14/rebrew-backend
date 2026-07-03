# ReBrew — Production Deployment Guide
**Server:** Hostinger VPS · Ubuntu 22.04 LTS  
**Stack:** Node.js 20 + PM2 + Nginx + Let's Encrypt  
**Domains:** `rebrew.in` (frontend) · `api.rebrew.in` (backend)

---

## Prerequisites

Before starting, have these ready:
- Root SSH access to the VPS
- DNS A records pointing `rebrew.in` and `api.rebrew.in` to the VPS IP
- All `.env` values from the environment variable checklist
- The `rebrew-backend.zip` and `rebrew-final.zip` build artifacts

Allow DNS to fully propagate before running Certbot (usually 5–30 minutes after setting records).

---

## Step 1 — Connect and Secure the Server

```bash
ssh root@<your-vps-ip>
```

Update the system:
```bash
apt update && apt upgrade -y
```

Create a non-root user for deployments:
```bash
adduser rebrew
usermod -aG sudo rebrew
```

Copy SSH keys to the new user:
```bash
rsync --archive --chown=rebrew:rebrew ~/.ssh /home/rebrew
```

Switch to the deploy user for all remaining steps:
```bash
su - rebrew
```

---

## Step 2 — Install Node.js 20 via NVM

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version   # v20.x.x
npm --version    # 10.x.x
```

---

## Step 3 — Install PM2 Globally

```bash
npm install -g pm2

# Verify
pm2 --version
```

---

## Step 4 — Install and Configure Nginx

```bash
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx

# Verify Nginx is running
sudo systemctl status nginx
```

Open firewall:
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

---

## Step 5 — Deploy the Backend

```bash
# Create the web directory
sudo mkdir -p /var/www/rebrew-backend
sudo chown rebrew:rebrew /var/www/rebrew-backend

# Upload the zip from your local machine (run this on your LOCAL machine)
scp rebrew-backend.zip rebrew@<your-vps-ip>:/var/www/

# Back on the server — extract
cd /var/www
unzip rebrew-backend.zip
mv rebrew-backend/* rebrew-backend/ 2>/dev/null || true
cd /var/www/rebrew-backend

# Install production dependencies only
npm install --omit=dev

# Create logs directory
mkdir -p logs
```

Create the `.env` file:
```bash
nano /var/www/rebrew-backend/.env
```

Paste all environment variables (see `ENVIRONMENT_CHECKLIST.md`), then save with `Ctrl+X, Y, Enter`.

Lock down the `.env` file:
```bash
chmod 600 /var/www/rebrew-backend/.env
chown rebrew:rebrew /var/www/rebrew-backend/.env
```

Test that the app starts correctly:
```bash
cd /var/www/rebrew-backend
node server.js
# Should print: REBREW API — PRODUCTION
# Press Ctrl+C to stop after confirming
```

---

## Step 6 — Deploy the Frontend

```bash
# Create the web directory
sudo mkdir -p /var/www/rebrew
sudo chown rebrew:rebrew /var/www/rebrew

# Upload from local machine
scp rebrew-final.zip rebrew@<your-vps-ip>:/var/www/

# On the server — extract
cd /var/www
unzip rebrew-final.zip
cp -r rebrew/* /var/www/rebrew/
```

---

## Step 7 — Configure Nginx

```bash
# Copy the Nginx config
sudo cp /var/www/rebrew-backend/nginx.conf /etc/nginx/sites-available/rebrew

# Enable the site
sudo ln -s /etc/nginx/sites-available/rebrew /etc/nginx/sites-enabled/rebrew

# Remove the default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test syntax — must show "syntax is ok" before proceeding
sudo nginx -t
```

---

## Step 8 — Install SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
```

**IMPORTANT:** Run two separate Certbot commands — one per certificate.
`nginx.conf` has two server blocks with separate `ssl_certificate` paths.
Running a single command with all three `-d` flags would store the cert only under
the first domain (`/live/rebrew.in/`), leaving `/live/api.rebrew.in/` missing and
causing Nginx to refuse to start.

```bash
# Certificate 1: frontend domains (stored at /live/rebrew.in/)
# IMPORTANT: DNS for rebrew.in AND www.rebrew.in must be live first
sudo certbot --nginx -d rebrew.in -d www.rebrew.in \
  --non-interactive --agree-tos --email admin@rebrew.in

# Certificate 2: API domain (stored at /live/api.rebrew.in/)
# IMPORTANT: DNS for api.rebrew.in must be live first
sudo certbot --nginx -d api.rebrew.in \
  --non-interactive --agree-tos --email admin@rebrew.in
```

Certbot automatically modifies the Nginx config to fill in the certificate paths
and creates systemd timers for auto-renewal.

Verify auto-renewal works for both certificates:
```bash
sudo certbot renew --dry-run
```

Reload Nginx with the final SSL config:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Step 9 — Start the API with PM2

```bash
cd /var/www/rebrew-backend

# Start using the ecosystem file
pm2 start ecosystem.config.js --env production

# Verify it's running
pm2 status
pm2 logs rebrew-api --lines 30

# Save the process list so PM2 restarts it after a server reboot
pm2 save

# Configure PM2 to start on system boot
pm2 startup
# Copy and run the command that PM2 prints — it looks like:
# sudo env PATH=$PATH:/home/rebrew/.nvm/versions/node/v20.x.x/bin pm2 startup systemd ...
```

---

## Step 10 — Connect Stripe Webhook

1. Go to [https://dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set URL to: `https://api.rebrew.in/api/v1/payments/webhook`
4. Select these events:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
5. Click **Add endpoint**
6. Copy the **Signing secret** (`whsec_...`)
7. Add it to `/var/www/rebrew-backend/.env` as `STRIPE_WEBHOOK_SECRET`
8. Restart the API: `pm2 restart rebrew-api`

---

## Step 11 — Smoke Test

Run these from your local machine after deployment:

```bash
# Health check
curl https://api.rebrew.in/health
# Expected: {"status":"ok","service":"rebrew-api","time":"..."}

# Confirm HTTPS redirect works
curl -I http://api.rebrew.in
# Expected: 301 redirect to https://

# Confirm API responds (should get 401, not 404 or 500)
curl https://api.rebrew.in/api/v1/auth/profile
# Expected: {"success":false,"message":"Authentication required..."}

# Frontend loads
curl -I https://rebrew.in
# Expected: 200 OK
```

---

## Ongoing Maintenance

**View logs:**
```bash
pm2 logs rebrew-api
pm2 logs rebrew-api --lines 100 --err   # errors only
tail -f /var/log/nginx/rebrew-api-error.log
```

**Restart after code update:**
```bash
cd /var/www/rebrew-backend
# Upload new files, then:
npm install --omit=dev
pm2 restart rebrew-api
pm2 logs rebrew-api --lines 20
```

**Monitor resource usage:**
```bash
pm2 monit
```

**Check disk usage:**
```bash
df -h
du -sh /var/www/rebrew-backend/logs/
```

**Rotate logs manually if needed:**
```bash
pm2 flush rebrew-api
```

**Renew SSL certificates** (runs automatically via systemd timer, but to run manually):
```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

## Directory Layout on Server

```
/var/www/
├── rebrew/                  # Frontend static files
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/
└── rebrew-backend/          # Node.js API
    ├── server.js
    ├── app.js
    ├── ecosystem.config.js
    ├── .env                 # 600 permissions — never commit
    ├── logs/
    │   ├── pm2-error.log
    │   └── pm2-out.log
    ├── controllers/
    ├── models/
    ├── routes/
    └── ...

/etc/nginx/
├── sites-available/rebrew   # Nginx config
└── sites-enabled/rebrew     # Symlink

/etc/letsencrypt/
└── live/
    ├── rebrew.in/           # Frontend SSL cert
    └── api.rebrew.in/       # API SSL cert
```
