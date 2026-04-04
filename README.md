# HireReady — Corporate Interview Assessment Platform

![status](https://img.shields.io/badge/status-live-brightgreen)
![version](https://img.shields.io/badge/version-2.0.0-blue)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?logo=vercel&logoColor=white)
![AI](https://img.shields.io/badge/AI--Powered-7C3AED?logo=anthropic&logoColor=white)

> A B2B SaaS platform that lets corporates assess employees and candidates through AI-generated interview questions, across 6 job categories and 3 difficulty levels — with a built-in leaderboard and Selcom payment integration.

**Live demo → [quizarena-steel.vercel.app](https://quizarena-steel.vercel.app)**

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Backend API](#backend-api)
- [Payment integration](#payment-integration)
- [Deployment](#deployment)
- [Roadmap](#roadmap)

---

## Overview

HireReady solves a real problem in East African corporate hiring: there's no standardised, scalable way to run consistent interview assessments across departments. HR teams at banks, telcos, and large corporates rely on ad-hoc panel interviews with no benchmark data.

HireReady gives them a platform where:
- **Employees and candidates** take timed, AI-generated assessments in their job category
- **HR managers** track scores, department pass rates, and completion via an admin dashboard
- **Companies** subscribe by plan (Starter / Business / Enterprise) and pay via any Tanzanian mobile wallet or card through Selcom's unified gateway

---

## Features

### Assessment engine
- 6 job categories: Software Engineering, Product Management, Finance, HR, Marketing, Leadership
- 3 difficulty levels: Easy, Medium, Hard
- AI-generated questions per session via the Anthropic API (falls back to a 500+ question bank offline)
- 20-second countdown per question with animated timer
- Streak system with live bonus tracking
- Full answer review screen on completion

### Platform
- Company leaderboard (all-time, weekly, by category)
- Admin dashboard: employee scores, department performance, quiz builder, assignment tracking
- AI Question Generator in admin panel — generate batches by category, difficulty, and focus area
- Subscription management with payment history
- CSV export of all employee scores

### Payments
- Selcom Checkout integration — single payment link supports M-Pesa, Airtel Money, Tigo Pesa, HaloPesa, TTCL, and card
- Webhook-driven subscription activation
- Background polling with pop-up fallback for blocked browsers
- Free / Business (TZS 150,000/mo) / Enterprise (TZS 500,000/mo) tiers

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Backend | Node.js, Express |
| Payments | Selcom API Gateway (`selcom-apigw-client`) |
| Fonts | Syne, DM Mono, Figtree (Google Fonts) |
| Icons | Font Awesome 6 |
| Hosting | Vercel (frontend), any Node host (backend) |

---

## Project structure

```
HireReady/
├── index.html              # Main app — quiz, leaderboard, pricing (single file)
├── admin-dashboard.html    # HR admin panel — scores, departments, AI builder
├── server.js               # Express backend — Selcom payments, scores, subscriptions
├── package.json
├── .env.example            # Environment variable template
└── README.md
```

The frontend is intentionally a single self-contained HTML file per view. No build step, no bundler — open `index.html` directly in a browser or deploy to any static host.

---

## Getting started

### Frontend only (no payments)

```bash
git clone https://github.com/jimmyurl/Quiz-App.git
cd Quiz-App
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

AI question generation works when running inside [claude.ai](https://claude.ai) or any environment where the Anthropic API is available. If you're hosting externally, the app falls back to the built-in question bank automatically — no errors, no config needed.

### With the payment backend

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# Fill in SELCOM_BASE_URL, SELCOM_API_KEY, SELCOM_API_SECRET, SELCOM_VENDOR
# Contact info@selcom.net to get sandbox credentials

# 3. Expose your server for Selcom webhooks (development)
npx ngrok http 3000
# Copy the HTTPS URL into SELCOM_WEBHOOK_URL in .env

# 4. Start
npm start
```

---

## Backend API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/payment/create-order` | Create Selcom Checkout order, returns `gatewayUrl` |
| `POST` | `/api/payment/webhook` | Selcom posts result here after customer pays |
| `GET` | `/api/payment/status/:order_id` | Poll payment result (pending / success / failed) |
| `POST` | `/api/payment/cancel/:order_id` | Cancel a pending order |
| `POST` | `/api/payment/wallet-push` | Push USSD prompt directly to phone (no redirect) |
| `GET` | `/api/subscription/:phone` | Check if a phone number has an active plan |
| `POST` | `/api/scores` | Submit a quiz result |
| `GET` | `/api/leaderboard` | Fetch top scores (filterable by category and period) |
| `GET` | `/api/health` | Health check |

---

## Payment integration

HireReady uses the **Selcom API Gateway** — Tanzania's leading payment aggregator. A single Selcom Checkout link lets customers pay with any wallet or card without you handling each network separately.

### Payment flow

```
Customer fills checkout form
        │
        ▼
POST /api/payment/create-order
        │
        ▼
Backend calls Selcom → gets gatewayUrl
        │
        ▼
Frontend opens gatewayUrl in new tab
        │
        ▼
Customer picks wallet (M-Pesa / Airtel / Tigo / card) and pays
        │
        ▼
Selcom POSTs result to /api/payment/webhook
        │
        ▼
Backend activates subscription for 30 days
        │
        ▼
Frontend poll detects 'success' → shows confirmation
```

### Supported channels

| Channel | Network |
|---|---|
| Vodacom M-Pesa | `076`, `077` |
| Airtel Money | `068`, `069` |
| Tigo Pesa / Mixx | `065`, `067` |
| HaloPesa | `062` |
| TTCL Pesa | `073` |
| Visa / Mastercard | Card |

### Going to production

1. Switch `SELCOM_BASE_URL` from the sandbox to `https://apigw.selcommobile.com`
2. Replace in-memory Maps with a real database (PostgreSQL schema included in `server.js` comments)
3. Set a publicly accessible `SELCOM_WEBHOOK_URL` (not localhost)

---

## Deployment

### Frontend — Vercel

The frontend deploys as a static site with zero configuration.

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Or connect your GitHub repo in the Vercel dashboard and every push to `main` deploys automatically.

### Backend — Railway / Render / VPS

The backend is a standard Express server. Any Node.js host works.

```bash
# Railway (one command)
railway up

# Or set these environment variables on your host:
SELCOM_BASE_URL
SELCOM_API_KEY
SELCOM_API_SECRET
SELCOM_VENDOR
SELCOM_WEBHOOK_URL
PORT
```

> **Note:** The backend must be on a publicly accessible URL so Selcom can POST webhook callbacks. Vercel serverless functions work but require converting `server.js` to individual route handlers.

---

## Environment variables

| Variable | Description |
|---|---|
| `SELCOM_BASE_URL` | `https://apigwtest.selcommobile.com` (sandbox) or `https://apigw.selcommobile.com` (production) |
| `SELCOM_API_KEY` | From Selcom developer portal — contact info@selcom.net |
| `SELCOM_API_SECRET` | From Selcom developer portal |
| `SELCOM_VENDOR` | Your vendor/till ID assigned by Selcom |
| `SELCOM_WEBHOOK_URL` | Public URL Selcom posts payment results to |
| `SELCOM_CANCEL_URL` | Page to redirect to if customer cancels payment |
| `PORT` | Server port (default: 3000) |

---

## Roadmap

- [ ] PostgreSQL integration (replace in-memory store)
- [ ] User accounts with persistent score history
- [ ] PDF certificate generation on pass
- [ ] Admin dashboard connected to live backend data
- [ ] Bilingual support (English / Swahili)
- [ ] Selcom wallet-push USSD flow (no browser redirect)
- [ ] Webhook signature verification

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach.

1. Fork the repo
2. Create your branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: describe your change'`
4. Push: `git push origin feature/your-feature`
5. Open a pull request

---

## License

MIT — free to use, modify, and distribute.

---

Built by [jimmyurl](https://github.com/jimmyurl) · Powered by [Selcom](https://selcommobile.com) · AI by [Anthropic](https://anthropic.com)