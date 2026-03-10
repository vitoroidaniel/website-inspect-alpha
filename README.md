# FleetInspect v2

Vehicle inspection platform for fleet maintenance teams.

## Auth Model

| Role | Login Method |
|------|-------------|
| Driver | Pick name from list → enter 4-digit PIN |
| Dispatcher | Username + password |
| Admin | Username + password (full access) |

## Default Credentials

| Role | Login | Password / PIN |
|------|-------|----------------|
| Admin | admin | admin123 |
| Dispatcher | dispatch | dispatch123 |
| Driver: James Rodriguez | (pick from list) | PIN: 1234 |
| Driver: Mike Thompson | (pick from list) | PIN: 5678 |

## Deploy to Railway

### Step 1 — Push to GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR/repo.git
git push -u origin main
```

### Step 2 — Create Railway project
1. https://railway.app → New Project → Deploy from GitHub
2. Select your repo — Railway auto-detects Node.js

### Step 3 — Add Volume (REQUIRED for photo persistence)
1. Project → Add Volume
2. Mount path: `/app/uploads`

### Step 4 — Environment Variables
```
SESSION_SECRET=<random 32+ char string>
DATABASE_PATH=/app/uploads/data.db
UPLOADS_DIR=/app/uploads
NODE_ENV=production
```

Generate secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Features
- Driver name picker + PIN login (no passwords for drivers)
- 8-step vehicle inspection (configurable by admin)
- Live camera capture enforced on mobile
- GPS coordinates per inspection
- Dispatcher CRM: per-driver inspection history
- Photo lightbox with keyboard nav
- ZIP download per inspection
- Admin: create/disable accounts, manage inspection steps
- Add custom inspection steps from dashboard

## Stack
Node.js · Express · SQLite (better-sqlite3) · Multer · Archiver
