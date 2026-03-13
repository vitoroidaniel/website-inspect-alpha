# Kurtex 🚛 Fleet Inspection Management System

[![Railway](https://img.shields.io/badge/Deploy-Railway-1EA5F2?style=for-the-badge&logo=railway)](https://railway.app/new)

**Kurtex** is a modern, mobile-first fleet inspection app built with Node.js, Express, and PostgreSQL. Drivers capture guided photo inspections with GPS stamping, biometric login (Face ID/Fingerprint), and automatic image compression. Dispatchers review, flag issues, download ZIP archives, and generate PDF reports. Superadmins manage users, assets, and inspection steps.

## ✨ Features

| **Drivers** | **Dispatchers** | **Admins** |
|-------------|-----------------|------------|
| 📱 Mobile camera integration | 👥 Fleet dashboard | 👨‍💼 User management |
| 📍 GPS location stamping | 🔍 Inspection history | 🚚 Asset/Trailer registry |
| 🔒 Biometric login (WebAuthn) | ⚑ Photo flagging | 📋 Custom inspection steps |
| 📦 Auto image compression | 📥 ZIP downloads | 🔐 Passwordless auth setup |
| ✅ Step-by-step checklists | 📄 PDF reports | 📊 Usage statistics |

### Tech Stack
```
Backend: Node.js 20+ | Express | PostgreSQL | Multer | Sharp
Frontend: Vanilla HTML/CSS/JS | Progressive Web App
Auth: bcrypt | WebAuthn (FIDO2) | Sessions
Deployment: Railway | Nixpacks | Vercel
```
- **25MB photo uploads** → **~1MB compressed JPEGs**
- **Offline-capable** PWA with camera permissions
- **Responsive** across phone/tablet/desktop

## 🎮 Quick Start (Demo Credentials)

```
Driver:     driver / driver123
Dispatcher: dispatch / dispatch123  
Admin:      admin / admin123
```

**Live Demo:** [kurtex.rekka.so](https://kurtex.rekka.so) *(if deployed)*

## 🚀 Deployment

### Railway (Recommended - 1-click)
1. Fork this repo
2. [Deploy to Railway](https://railway.app/new)
3. Add Railway PostgreSQL volume
4. Set env vars:
```
SESSION_SECRET=your-secret
DATABASE_URL=postgresql://...
UPLOADS_DIR=/app/uploads
RP_ID=yourdomain.com
RP_ORIGIN=https://yourdomain.com
```

### Local Development
```bash
# Clone & Install
git clone https://github.com/yourorg/kurtex.git
cd kurtex
npm install

# Start Postgres (Docker)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=kurtex postgres:15

# Init DB & Run
npm run db:setup
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

## 🗄️ Database Setup

The app auto-creates tables on first run (users, assets, inspections, photos, etc.) via database.js.

**Local:** Uses SQLite by default (`DATABASE_URL=sqlite://db.sqlite`)
**Production:** PostgreSQL (`DATABASE_URL=postgresql://...`)

Run migrations: `npm run db:migrate`
Demo data: `npm run db:seed`

See `/database.js` for schema details. No sensitive data required.

## 📱 Screenshots

| Driver Inspection | Agent Dashboard | Photo Review |
|-------------------|-----------------|--------------|
| ![Driver](screenshots/driver.png) | ![Dashboard](screenshots/agent.png) | ![Review](screenshots/review.png) |

| Admin Panel | PDF Report | Biometric Login |
|-------------|------------|-----------------|
| ![Admin](screenshots/admin.png) | ![Report](screenshots/report.png) | ![Biometrics](screenshots/biometric.png) |

## 🛣️ API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `POST` | `/api/login` | Public | Username/password login |
| `POST` | `/api/auth/webauthn/login` | Public | Biometric login |
| `POST` | `/api/inspections/:id/start` | Driver | Begin inspection |
| `POST` | `/api/inspections/:id/step/:step/photo` | Driver | Upload photo |
| `GET` | `/api/agent/inspections/:id/report` | Agent | PDF report HTML |
| `GET` | `/api/agent/inspections/:id/download` | Agent | ZIP download |
| `PATCH` | `/api/agent/photos/:id/flag` | Agent | Flag photo |

**Full OpenAPI spec:** [openapi.json](openapi.json) *(add if needed)*

## 🏗️ Architecture

```
Kurtex App
├── server.js (Express + Session + Multer)
├── database.js (SQLite/Postgres queries)
├── public/
│   ├── login.html/js (Auth)
│   ├── agent.html/js (Dashboard)
│   └── driver.html/js (Camera/Inspection)
├── uploads/ (Photos - 70% JPEG compression)
└── DB Schema (Users/Inspections/Photos/Assets)
```

## 🔧 Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `PORT` | 3000 | Server port |
| `SESSION_SECRET` | dev-secret | Session encryption |
| `DATABASE_URL` | sqlite://db.sqlite | Postgres connection |
| `UPLOADS_DIR` | ./uploads | Photo storage |
| `RP_ID` | localhost | WebAuthn domain |

## 🤝 Contributing

1. Fork & clone
2. `npm install`
3. `npm run dev`
4. Add tests: `npm test`
5. PR to `main` with changelog

**Issues:** [Create Issue](https://github.com/yourorg/kurtex/issues/new)

## 📄 License

MIT © [Rekka Software](https://rekka.so) *(2024)*

---

<div align="center">
Built with ❤️ for fleet operators | <strong>🚀 Ready for production</strong>
</div>
