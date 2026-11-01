# Gaver formally known as and internally refered to as DinnerRaise API

#please note this Read me is an AI summary but I (Trent) personally have read through it and I approve of the following

A real-time backend for a fundraising dinner platform where hosts sell seats to events and guests request or accept invitations to attend. Built with Node.js, Express, TypeScript, and Stripe, featuring JWT authentication, PostgreSQL transactions, and webhook-driven payment confirmation.

**[Frontend repo](#coming-soon)**

## Why this project?

Traditional donation platforms ask for money with no clear value exchange. DinnerRaise flips that: guests pay for dinner seats, hosts raise funds through ticket sales, and real-time capacity management prevents overbooking. Built as a portfolio piece to demonstrate full-stack competency, real-world problem-solving, and payment processing expertise.

## Tech stack

- **Runtime:** Node.js 20+ with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL 18+ with Prisma ORM
- **Authentication:** JWT (jsonwebtoken) + bcrypt
- **Payments:** Stripe Checkout + webhook signature verification
- **Validation:** Zod
- **Dev tools:** tsx, Prisma Studio

## Key architectural decisions

### Money as integer cents
Seat prices stored as `seatPriceCents` (integer) instead of floats to avoid rounding errors. Stripe API works in the same units, keeping precision throughout.

### Capacity counted in a transaction
Seat approval and invitation confirmation happen inside `prisma.$transaction()`. The capacity check and seat creation are atomic: either both succeed or both fail. This prevents race conditions where a seat is approved after the last slot is taken.

### Two-status seat lifecycle
Seats move `PENDING` → `AWAITING_PAYMENT` → `CONFIRMED` (or `DECLINED` / `CANCELLED`). Only `CONFIRMED` and `AWAITING_PAYMENT` seats count against capacity, because both represent committed reservations.

### Stripe webhook signature verification
The webhook route receives the **raw** request body (before JSON parsing) and validates Stripe's signature using the webhook secret. The `raw()` middleware ensures the body hasn't been altered. Invalid signatures return `400` immediately.

### Single-use invitation tokens
Each invitation has a unique `token` (32 random hex bytes). On confirmation, `usedAt` is set in the same transaction as seat creation. The token can't be reused, and retried webhooks are harmless because the seat is already `CONFIRMED`.

### Idempotent payment confirmation
The webhook uses `updateMany` with a status check: only `AWAITING_PAYMENT` seats can move to `CONFIRMED`. If Stripe retries the webhook, the second run matches no rows and changes nothing.

### Expired checkout sessions
Stripe sessions expire after 30 minutes of inactivity. The webhook listens for `checkout.session.expired` and cancels the seat, freeing its place immediately. No capacity is wasted on unpaid reservations.

## Payment flow

# Request path (guest initiates)
1. Guest requests seat → status = PENDING
   ↓
2. Host approves → status = AWAITING_PAYMENT
   ↓
3. Guest opens checkout link (host sends it or guest finds it)
   ↓
4. Stripe Checkout page (guest enters card)
   ↓
5. Stripe webhook calls POST /webhooks/stripe
   ↓
6. Server verifies signature, updates seat → CONFIRMED
   ↓
7. Guest sees confirmation, host sees booking

# Invite path (host initiates)
1. Host creates invitation → generates unique token/link
   ↓
2. Host sends link to guest (email, SMS, Slack, etc. — out of band)
   ↓
3. Guest clicks link, enters name → POST /invitations/:token/confirm
   ↓
4. Server creates seat with status = AWAITING_PAYMENT
   ↓
5. Server immediately creates Stripe Checkout session
   ↓
6. Response returns checkout URL to guest
   ↓
7. Guest clicks checkout link (or is redirected)
   ↓
8. Stripe Checkout page (guest enters card)
   ↓
9. Stripe webhook calls POST /webhooks/stripe
   ↓
10. Server verifies signature, updates seat → CONFIRMED
    ↓
11. Guest sees confirmation, host sees booking

Key differences:

# Request path: Guest starts, host approves (manual step), then payment
# Invite path: Host starts, guest confirms name (1 step), payment is automatic and immediate — the checkout link is returned right away, no host approval needed
# Invite path skips one step: No PENDING status; the seat goes straight to AWAITING_PAYMENT when the guest confirms their name


## Installation

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Git

### Steps

1. Clone the repo:
   bash
   git clone https://github.com/Trent-mack-williams/dinnerraise-api.git
   cd dinnerraise-api
   

2. Copy the environment template:
   bash
   cp .env.example .env
   
   Edit `.env` with your values:
   - `DATABASE_URL`: PostgreSQL connection string
   - `JWT_SECRET`: A long random string (use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `STRIPE_SECRET_KEY`: From your Stripe dashboard
   - `STRIPE_WEBHOOK_SECRET`: From `stripe listen` (see testing below)

3. Install dependencies:
   bash
   npm install
   

4. Set up the database:
   bash
   npm run db:migrate
   

5. Start the server:
   bash
   npm run dev
   
   The API runs on `http://localhost:4000`.

## Running locally with Stripe webhooks

To test payments end-to-end, you need the Stripe CLI to forward webhook events to your computer:

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli).
2. Authenticate:
   bash
   stripe login
   
3. Start the forwarder:
   bash
   stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:4000/webhooks/stripe
   
4. Copy the webhook signing secret it prints and add it to `.env` as `STRIPE_WEBHOOK_SECRET`.
5. Restart `npm run dev`.

To test a payment:
- Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
- The seat status will change from `AWAITING_PAYMENT` to `CONFIRMED` in the database.

## API endpoints

### Authentication
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/guest-email` | None | Find or create guest by email |
| POST | `/auth/host-email` | None | Find or create host by email |
| POST | `/auth/host-password` | None | Set password on host account |
| POST | `/auth/login` | None | Returns JWT token (7-day expiry) |
| GET | `/auth/me` | Bearer token | Returns logged-in user details |

### Events
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/events` | HOST token | Create event (validates future date) |
| GET | `/events/mine` | HOST token | List this host's events |
| GET | `/events/:id` | None | Public event details + seatsRemaining |
| POST | `/events/:id/seats` | None | Open request for a seat (PENDING) |
| POST | `/events/:id/invitations` | HOST token | Create single-use invite link |

### Seats
| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | `/seats/:seatId` | HOST token | Approve (→AWAITING_PAYMENT) or decline (→DECLINED) |

### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/checkout/:seatId` | None | Create Stripe Checkout session for seat |

### Invitations
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/invitations/:token/confirm` | None | Confirm seat via invite link, returns checkout URL |

### Webhooks
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/stripe` | Stripe signature | Handles checkout.session.completed and checkout.session.expired |

## Scripts

bash
npm run dev              # Start dev server with hot reload (tsx watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled server (node dist/server.js)
npm run db:migrate       # Run pending Prisma migrations
npm run db:studio        # Open Prisma Studio UI (port 5555)


## Database schema

See `prisma/schema.prisma` for the full schema. Key tables:

- **User**: Hosts (with password) and guests (email only)
- **Event**: Dinner event with title, location, date, seat price, capacity
- **Seat**: Booking with status (PENDING, AWAITING_PAYMENT, CONFIRMED, DECLINED, CANCELLED)
- **Invitation**: Single-use invite tokens tied to events
- **Stripe fields**: `stripePaymentIntentId`, `stripeSessionId`, `stripePriceId` on Seat

## Testing

All API endpoints have been tested end-to-end using PowerShell and Stripe's test environment. Examples:

powershell
# Log in
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"host@example.com","password":"secret123"}'

# Create event
$event = (Invoke-RestMethod -Method Post -Uri http://localhost:4000/events `
  -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $($login.token)" } `
  -Body (@{ title = "Fundraiser"; location = "London"; startsAt = "2027-08-01T19:00:00Z"; seatPriceCents = 2500; capacity = 10 } | ConvertTo-Json)).event

# Check capacity
Invoke-RestMethod -Uri "http://localhost:4000/events/$($event.id)"


## Git history

The repo includes 13 commits showing the development process:
- Initial setup with Express, TypeScript, Prisma
- Auth with JWT and bcrypt
- Event management and capacity checking
- Seat requests and invitations
- Stripe Checkout integration
- Webhook signature verification and payment confirmation
- Expiry handling and capacity fixes

Each commit is focused and includes one feature or fix.

## Next steps

- **Frontend**: React + Vite + TypeScript app for guests and hosts
- **Email notifications**: Guests invited, hosts notified of requests
- **Admin dashboard**: Analytics on events, revenue, attendance
- **Docker**: Containerize for easy deployment

## License

MIT

## Author

[Trent Williams](https://github.com/Trent-mack-williams) — London-based developer