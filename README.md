<div align="center">

# 💸 Transactions

**A real-time web app for tracking shared transactions and balances with anyone.**

Record payments, get email notifications, and approve or dispute transactions — all synced instantly.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-10-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **Email + Google Sign-in** | Firebase Authentication with multiple providers |
| 📨 **Invite by Email** | Pair with anyone to start tracking a shared balance |
| 💰 **Record Transactions** | Log payments in either direction with descriptions |
| ✅ **Approve / Dispute** | Partner must approve each transaction before balance updates |
| ⚡ **Real-time Sync** | Firestore `onSnapshot` keeps both users in sync instantly |
| 📧 **Email Notifications** | Both parties get emails on new transactions, approvals, and disputes |
| 📱 **Responsive** | Works on desktop and mobile browsers |
| 🆓 **Free to Host** | Firebase free tier + Vercel free tier |

---

## 🏗️ Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌─────────┐
│   Next.js App    │────▶│  Firebase Auth    │     │ EmailJS │
│   (App Router)   │────▶│  Cloud Firestore  │     │ (email) │
│                  │     │                   │     │         │
└──────────────────┘     └──────────────────┘     └─────────┘
```

**No custom backend needed.** Firebase handles auth and data. Firestore Security Rules enforce per-user access. EmailJS sends notification emails from the client.

### Data Model (Firestore)

| Collection | Purpose |
|---|---|
| `users/{uid}` | User profile (name, email, preferred currency) |
| `pairs/{pairId}` | Shared balance between two users |
| `pairs/{pairId}/transactions/{txId}` | Individual transactions with approval workflow |
| `invites/{inviteId}` | Email invites for pairing |

### Transaction Flow

```
1. User A records a transaction → status: "pending"
2. User B gets an email notification
3. User B either approves (balance updates atomically) or disputes (with a reason)
4. Both parties are emailed the outcome
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Firebase CLI** — `npm install -g firebase-tools`
- A **Firebase project** ([create one here](https://console.firebase.google.com/))

---

### 1. Clone & Install

```bash
git clone https://github.com/ZSturman/Transactions
cd web
npm install
```

### 2. Set Up Firebase

<details>
<summary><strong>Step-by-step Firebase setup</strong> (click to expand)</summary>

#### Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Click **"Create a project"** (or use an existing one)
3. Give it a name (e.g., `transactions`) and follow the prompts
4. Disable Google Analytics if you don't need it (or keep it enabled)

#### Enable Authentication

1. In your project, go to **Build → Authentication → Get started**
2. Under **Sign-in method**, enable:
   - **Email/Password** — Click, toggle on, save
   - **Google** — Click, toggle on, select a support email, save

#### Create a Firestore Database

1. Go to **Build → Firestore Database → Create database**
2. Choose **Start in production mode** (we'll deploy security rules)
3. Pick a region close to your users (e.g., `us-central1`)

#### Create Composite Indexes

Firestore requires composite indexes for queries with multiple filters. Create these:

1. Go to **Firestore → Indexes → Composite**
2. Add the following indexes:

| Collection | Fields | Order |
|---|---|---|
| `pairs` | `users` (Arrays), `updatedAt` (Descending) | — |
| `invites` | `toEmail` (Ascending), `status` (Ascending) | — |

> **Tip:** If you skip this step, the browser console will show a link to auto-create the missing index when you first use the app.

#### Get Your Firebase Config

1. Go to **Project Settings** (gear icon) → **General**
2. Under **Your apps**, click **Web** (</>) to register a web app
3. Give it a nickname (e.g., `transactions-web`)
4. Copy the `firebaseConfig` values — you'll need them for `.env.local`

#### Deploy Security Rules

```bash
firebase login
firebase use --add  # select your project
npm run deploy:rules
```

</details>

### 3. Configure Environment Variables

Copy the example and fill in your Firebase config:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your Firebase values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXX
```

### 4. (Optional) Set Up EmailJS

Email notifications are optional — the app works without them.

<details>
<summary><strong>EmailJS setup</strong> (click to expand)</summary>

1. Sign up at [emailjs.com](https://www.emailjs.com/) (free tier: 200 emails/month)
2. **Create an email service** — connect Gmail, Outlook, or another provider
3. **Create 2 email templates** with these names:
   - `template_transaction` — New transactions, approvals, and disputes
   - `template_invite` — Pair invitation
4. Each template should use these variables:
   - `{{to_name}}`, `{{from_name}}`, `{{subject}}`, `{{message}}`, `{{action_url}}`
5. Copy your **Service ID**, **Public Key**, and **Template IDs** into `.env.local`:

```env
NEXT_PUBLIC_EMAILJS_SERVICE_ID=service_xxxxx
NEXT_PUBLIC_EMAILJS_PUBLIC_KEY=your_public_key
NEXT_PUBLIC_EMAILJS_TEMPLATE_TRANSACTION=template_transaction
NEXT_PUBLIC_EMAILJS_TEMPLATE_INVITE=template_invite
```

</details>

### 5. Run the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 🌐 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Set the **Root Directory** to `web` (if it's in a monorepo)
4. Add all `NEXT_PUBLIC_*` environment variables in the Vercel dashboard
5. Deploy — Vercel auto-detects Next.js

### Firebase Hosting (via App Hosting)

Firebase App Hosting supports Next.js natively:

1. Install the Firebase CLI: `npm install -g firebase-tools`
2. Run `firebase init apphosting` and follow the prompts
3. Push to your connected GitHub repo to trigger a deploy

> **Note:** Firestore security rules are deployed separately with `npm run deploy:rules`.

---

## 📁 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | ✅ | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | ✅ | Firebase Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ✅ | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | ✅ | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | ✅ | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | ✅ | Firebase app ID |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | ❌ | Google Analytics measurement ID |
| `NEXT_PUBLIC_EMAILJS_SERVICE_ID` | ❌ | EmailJS service ID |
| `NEXT_PUBLIC_EMAILJS_PUBLIC_KEY` | ❌ | EmailJS public key |
| `NEXT_PUBLIC_EMAILJS_TEMPLATE_TRANSACTION` | ❌ | EmailJS template: new transactions, approvals, and disputes |
| `NEXT_PUBLIC_EMAILJS_TEMPLATE_INVITE` | ❌ | EmailJS template: pair invite |

---

## 🗂️ Project Structure

```
web/
├── next.config.ts                 # Next.js configuration
├── package.json
├── tsconfig.json                  # TypeScript config with @/ alias
├── tailwind.config.js             # Tailwind CSS config
├── postcss.config.js
├── firebase.json                  # Firestore rules deployment
├── firestore.rules                # Firestore security rules
├── .env.local.example             # Environment variable template
├── .gitignore
├── public/                        # Static assets
└── src/
    ├── app/                       # Next.js App Router
    │   ├── globals.css            # Tailwind + custom styles
    │   ├── layout.tsx             # Root layout (AuthProvider, Toaster)
    │   ├── not-found.tsx          # 404 page
    │   ├── (auth)/                # Public routes (login, register)
    │   │   ├── layout.tsx         # Redirects authenticated users away
    │   │   ├── login/page.tsx
    │   │   └── register/page.tsx
    │   └── (protected)/           # Authenticated routes
    │       ├── layout.tsx         # Auth guard + navigation shell
    │       ├── page.tsx           # Dashboard
    │       ├── pair/[pairId]/page.tsx  # Balance detail + transactions
    │       └── settings/page.tsx  # User profile & preferences
    ├── components/                # Reusable UI components
    │   ├── BalanceSummary.tsx
    │   ├── InviteForm.tsx
    │   ├── Layout.tsx             # Header + navigation + footer
    │   ├── PairCard.tsx
    │   ├── ProtectedRoute.tsx     # Auth guard wrapper
    │   ├── TransactionForm.tsx
    │   ├── TransactionItem.tsx
    │   └── TransactionList.tsx
    ├── contexts/
    │   └── AuthContext.tsx         # Firebase Auth state management
    ├── hooks/
    │   ├── useInvites.ts          # Real-time invite subscriptions
    │   ├── usePairs.ts            # Real-time pair subscriptions
    │   └── useTransactions.ts     # Real-time transaction subscriptions
    ├── lib/
    │   ├── firebase.ts            # Firebase app initialization
    │   └── emailjs.ts             # EmailJS notification helpers
    ├── types/
    │   └── index.ts               # TypeScript interfaces + currency data
    └── utils/
        └── currency.ts            # Currency formatting helpers
```

---

## 📝 Scaling Notes

- **Email volume**: EmailJS free tier = 200/month. Two active users at ~5 transactions/week ≈ 40 emails/month. For higher volume, switch to Firebase Cloud Functions + [Resend](https://resend.com) (100/day free).
- **Multiple pairs**: The app supports multiple pairs per user. Each pair is independent.
- **Offline support**: Firestore has built-in offline persistence. Transactions sync when back online.

---

## 📄 License

MIT
