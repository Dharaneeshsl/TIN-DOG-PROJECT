# TIN-DOG

TIN-DOG is a production-oriented dog social discovery product. Dog owners create authenticated profiles, discover other real profiles, express interest, form mutual matches, message privately, manage their dog profile, and choose a membership plan through a provider-backed checkout flow.

## Product architecture

The frontend is a React application bundled by Vite. The backend is an Express API served by the same Node.js process. SQLite provides durable relational persistence for users, dogs, swipes, matches, conversations, messages, orders, subscriptions, and payment events. Authentication uses signed JWTs with bcrypt password hashing. Inputs are validated with Zod, uploads are restricted by type and size, rate limiting protects the API, and payment webhooks are signature-verified and idempotent.

| Layer | Implementation |
|---|---|
| Client | React 19, Vite, component-based state and event handling |
| API | Express, REST endpoints under `/api` |
| Persistence | SQLite via `better-sqlite3` |
| Authentication | JWT bearer tokens, bcrypt password hashing |
| Validation | Zod schemas and route-level error handling |
| Payments | Stripe Checkout or Razorpay Orders, selected through environment configuration |
| Assets | Repository-local public assets plus controlled profile uploads |
| Verification | Vitest integration tests and Vite production builds |

## Features

The public React experience includes the product landing page, feature explanation, pricing plans, signup and login modals, responsive navigation, and clear payment configuration states. The authenticated experience includes discovery filters, real like/pass actions, mutual matching, private conversations, dog profile editing with image upload, subscription state, checkout initiation, billing history, and logout.

A like only becomes a match when the other owner has also liked the profile. Matches and conversations are persisted in SQLite. Free plan activation is persisted as an order and subscription. Paid plans use the configured payment provider, and a missing provider credential fails safely before an order is created.

## Local setup

Use Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

The development server runs at `http://localhost:3000` and serves the Vite React application through the Express fallback. For a production-style local run:

```bash
npm run build
NODE_ENV=production npm start
```

The server serves the compiled `dist` bundle when it exists. The API health endpoint is available at `/api/health`.

## Environment configuration

Environment variables are intentionally left for the operator to provide. Start from `.env.example` and set a long random `JWT_SECRET`, a persistent `DATABASE_PATH`, an `UPLOAD_DIR`, the public `APP_URL`, permitted `CORS_ORIGINS`, and the selected payment provider credentials.

`SEED_DEMO_DATA` defaults to `false`. Production discovery therefore contains only real registered profiles. It may be set to `true` only in an isolated local environment when synthetic records are explicitly wanted for testing; the integration suite enables it in its own temporary database.

For Stripe, provide `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. For Razorpay, provide `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Never commit `.env` or provider credentials.

## Frontend source

The React client is contained in:

```text
src/
├── App.jsx       # Product screens, state, API calls, and user flows
├── main.jsx      # React root mount
└── styles.css    # Responsive product design system
```

There is no vanilla frontend controller. The root HTML document contains only the React mount point and module entry. The former root-level `app.js` and `styles.css` files have been removed.

## Backend source

`server.js` contains the API, database schema initialization, authentication middleware, profile routes, discovery and swipe logic, match and conversation routes, upload handling, order and subscription state, Stripe and Razorpay adapters, webhook verification, error handling, and React production fallback.

The API surface includes authenticated routes for `/api/auth`, `/api/user/profile`, `/api/dogs`, `/api/swipes`, `/api/matches`, `/api/conversations`, `/api/billing`, and `/api/payments`, plus public plan and health endpoints.

## Verification

Run the complete local verification suite:

```bash
npm run lint
npm test
```

The lint command checks backend syntax and creates a production React build. The integration suite runs against an isolated SQLite database and covers registration, login, authenticated session access, profile updates, free membership activation, missing-payment-credential safety, discovery, mutual matching, and conversation creation.

## Repository hygiene

The repository excludes environment files, local databases, uploads, logs, and build output through `.gitignore`. No deployment credentials are included. The current local working tree intentionally contains uncommitted changes; commit and push operations require explicit operator authorization.
