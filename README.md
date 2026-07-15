# Transactions

A real-time Next.js app for tracking shared balances. Firebase Authentication and Firestore remain the source of truth; Vercel hosts the app and its small server-side email route.

## What it supports

- Email/password and Google sign-in.
- Expiring, single-use invitations. Invitation links take the recipient through sign-in or account creation, then only the invited email can accept.
- Pending transaction approval, disputes, settlements, forgiveness, archives, and live balances.
- Resend notifications for invitations, new transaction requests, and resolutions. Users can opt out of nonessential transaction and resolution emails in Settings.
- CSV import with auto-detection, column mapping, previews, validation, duplicate detection, chunked progress, and an import result summary.
- CSV exports for spreadsheet use and complete JSON exports that preserve pair, transaction, relationship, and status identifiers.

## Email and invitation design

The browser never sends an arbitrary address or message to the email endpoint. It submits an authenticated Firebase ID token and a resource ID; the server verifies the token with Firebase Admin, derives the recipient and content from Firestore, and then sends with Resend.

Each email event is reserved in the server-only `notificationDeliveries` collection before it is sent. Repeated browser requests return the prior result rather than sending again. If Resend reports an error, the transaction or invitation remains saved, the delivery is recorded as failed, and it is not automatically retried—this deliberately favors avoiding duplicate mail when a provider request has an uncertain outcome.

New invitations expire after seven days. The random Firestore invitation ID is the unguessable link token; it is never exposed in list views. Firestore rules bind the recipient email, expiration, accepted user, and pair activation together.

## Local setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Enable Email/Password and Google under Firebase Authentication, create a production Firestore database, then deploy the included rules:

```bash
firebase login
firebase use --add
npm run deploy:rules
```

Create the following composite Firestore indexes if prompted:

| Collection | Fields |
|---|---|
| `pairs` | `users` (array contains), `updatedAt` (descending) |
| `invites` | `toEmail` (ascending), `status` (ascending) |
| `invites` | `fromUid` (ascending), `status` (ascending) |

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `NEXT_PUBLIC_FIREBASE_*` | Yes | Firebase Web SDK configuration. |
| `NEXT_PUBLIC_APP_URL` | Production | Canonical application URL in email links, e.g. `https://transactions-lmct.vercel.app`. |
| `RESEND_API_KEY` | For email | Server-only Resend API key. |
| `RESEND_FROM_ADDRESS` | For email | A verified Resend sender, such as `Transactions <notifications@example.com>`. |
| `FIREBASE_ADMIN_PROJECT_ID` | For email | Firebase project ID for the Vercel server route. |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | For email | Service-account client email. |
| `FIREBASE_ADMIN_PRIVATE_KEY` | For email | Service-account private key; store escaped newlines as `\n`. |

Without the Resend and Firebase Admin variables, the app continues to save invitations and transactions but safely marks email as unavailable. No email secret has a `NEXT_PUBLIC_` prefix.

For a quick local test without owning a domain, use `Transactions <onboarding@resend.dev>` as `RESEND_FROM_ADDRESS`. Resend restricts that testing sender to the email address on your Resend account (and its documented test recipients), so it cannot deliver invitations to arbitrary users. For real invitations, add a domain or subdomain you control to Resend and publish its SPF/DKIM DNS records. The default `transactions-lmct.vercel.app` hostname is useful for links, but it is not a domain you can verify as your sender unless you control its DNS.

## Vercel deployment

The existing Vercel deployment at `https://transactions-lmct.vercel.app/` needs the environment variables above added in Vercel Project Settings → Environment Variables for Production (and Preview if desired). Use the service account JSON from Firebase Console → Project Settings → Service Accounts to populate the three `FIREBASE_ADMIN_*` values. Set `NEXT_PUBLIC_APP_URL` to the production URL so invitation links do not point at a preview deployment.

After the variables are saved, deploy normally through the connected repository or Vercel CLI, then deploy Firestore rules separately with `npm run deploy:rules`.

## Import and export behavior

CSV imports accept familiar alternatives such as `Amount`, `Total`, `Memo`, `Paid by`, `Transaction date`, and `Type`. Amount plus either Direction or a payment/request Type is required. The importer accepts common currency formats, ISO dates, and US-style slash dates. It previews the first 30 rows, reports all invalid-row counts, and skips both duplicate rows already in the pair and repeated rows in the same file.

Imported rows are deterministic and contain an import fingerprint, so retrying an interrupted import cannot create another copy. Imports intentionally do not email a partner for every historical row. The default limits are 10 MB and 20,000 rows; split larger files before importing.

CSV exports are flat and spreadsheet-friendly. JSON exports include pair and transaction IDs, user relationships, statuses, archived flags, and timestamps.

## Verification

```bash
npm run build
npm run test:e2e
```

The Playwright suite runs against Firebase Auth and Firestore emulators. It covers authentication, transaction approval and disputes, secure-link invitation acceptance, CSV import/export, and email-route request behavior. Before release, manually verify a Resend delivery from the deployed Vercel environment using two real accounts, including the recipient preference opt-outs and an expired invitation.
