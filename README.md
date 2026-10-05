# Algorisys Conference Hall Booking

An internal, multi-user conference hall booking system for Algorisys employees.
Real backend, real shared SQLite database, server-side authentication and
role authorization, company-email verification via OTP, and backend-enforced
booking rules (today-only bookings, no overlaps, Asia/Kolkata time).

This is a working application, not a mockup: there is no localStorage
"database" anywhere, and every rule described below is enforced on the
server, not just in the browser.

---

## 1. What you get

- **Backend:** Node.js + Express
- **Database:** SQLite (`better-sqlite3`), one shared file all ~100 employees read/write
- **Auth:** express-session (HTTP-only cookie) + bcrypt password hashing
- **Email verification:** Nodemailer/SMTP, 6-digit OTP, hashed, expires in 10 minutes
- **Frontend:** Plain HTML/CSS/JS, responsive, installable as a Progressive Web App
- Two roles (`ADMIN`, `EMPLOYEE`), two halls (`Board Room`, `Small Conference Room`)

---

## 2. Requirements

- Node.js 18 or newer ([nodejs.org](https://nodejs.org))
- npm (comes with Node.js)
- An SMTP account to send OTP emails (see section 5)

Check your Node version:

```bash
node -v
```

---

## 3. Installation

```bash
cd Algorisys-Conference-Hall-Booking
npm install
```

This installs Express, better-sqlite3, bcryptjs, express-session,
connect-sqlite3 (session storage), nodemailer, and dotenv.

---

## 4. Environment configuration

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
PORT=3000
NODE_ENV=development

# Generate a real random secret, e.g.:
# node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SESSION_SECRET=replace_with_a_long_random_string

SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM="Algorisys Conference Booking <no-reply@algorisys.com>"
```

**Never commit `.env` to version control.** It is already in `.gitignore`.

---

## 5. SMTP configuration

The app needs a real SMTP account to send the 6-digit verification code
when someone registers. Any standard SMTP provider works, for example:

- Your company's own mail server / Microsoft 365 / Google Workspace SMTP relay
- A transactional email service (SendGrid, Mailgun, Amazon SES, Postmark, etc.)

If `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` are missing, the app will not
silently fail — registration will return a clear error:

> "Email service is not configured on the server. Contact your administrator
> to configure SMTP settings."

SMTP credentials are read only from environment variables on the server.
They are never sent to or exposed in frontend JavaScript.

---

## 6. Database

No manual setup needed. On first start, the app:

1. Creates `database/conference_booking.db` (SQLite file) if it doesn't exist.
2. Creates all tables (`users`, `halls`, `bookings`, `email_verifications`).
3. Seeds the two halls: **Board Room** and **Small Conference Room**.
4. If there are zero users in the database, creates the first admin account
   (see section 8).

The database file and session store (`database/sessions.db`) are excluded
from git via `.gitignore`, since they contain live company data.

The schema uses plain SQL and parameterized queries only, so migrating later
to PostgreSQL or SQL Server means re-pointing the queries in `config/db.js`
and the `routes/*.js` files at a new driver — the application logic itself
does not need to change.

---

## 7. Running the app

```bash
npm start
```

Then open:

```
http://localhost:3000
```

For ~100 concurrent employees, everyone connects to the same running server
and the same SQLite file — there is no per-user local storage.

---

## 8. First admin login

On first run, the server creates:

```
Email:    admin@algorisys.com
Password: Admin@12345
```

**Change this password immediately** after your first login. You can do
this from the app (a "change password" API endpoint is available at
`POST /api/change-password`, which any logged-in user, including the
admin, can call with `currentPassword`, `newPassword`, `confirmNewPassword`).

---

## 9. How employees use it

1. Go to `http://your-server-address:3000` (or your deployed HTTPS URL).
2. Register with a `@algorisys.com` email, full name, department, and password.
3. Check email for a 6-digit code, enter it — the account is created and the
   employee is logged in automatically.
4. From the dashboard: pick a hall, pick a start/end time (today only),
   click "Check availability", enter a purpose, then "Confirm booking".
5. "Today's schedule" shows both halls' bookings (times only — no other
   employees' personal details are shown to ordinary employees).
6. "My bookings" lists the employee's own bookings and lets them cancel
   any booking that hasn't started yet.

## 10. How admins use it

Log in with the admin account to see a separate dashboard: summary counts,
a fully filterable table of every booking (by date, hall, employee, status)
with full employee details, the ability to cancel any booking at any time,
and a table of all employees with an activate/deactivate toggle (an admin
cannot deactivate their own currently-logged-in account).

---

## 11. Installing it like an app (without an app store)

The frontend is a Progressive Web App (PWA): it ships a web manifest and a
service worker. Once the site is served over **HTTPS** (required by
browsers for PWA install, `localhost` is exempted for testing):

- **Android (Chrome):** open the site → menu → "Install app" / "Add to Home
  screen". It installs an icon that opens in its own window, no Play Store
  involved.
- **iPhone/iPad (Safari):** open the site → Share button → "Add to Home
  Screen".
- **Desktop (Chrome/Edge):** an install icon appears in the address bar, or
  use the browser menu → "Install Algorisys Booking...".

This gives employees an app-like icon and standalone window without any
app-store distribution. The API calls always go over the network (never
cached), so booking data is always live; only the static shell (HTML/CSS/JS)
is cached for fast reopening.

---

## 12. Project structure

```
Algorisys-Conference-Hall-Booking/
│
├── server.js                  Express app entry point
├── package.json
├── .env.example
├── .gitignore
├── README.md
│
├── config/
│   ├── db.js                  SQLite connection, schema, seeding
│   └── mailer.js               Nodemailer/SMTP setup
│
├── middleware/
│   └── auth.js                requireAuth / requireAdmin (server-side only)
│
├── routes/
│   ├── auth.js                 signup, verify-email, resend, login, logout, me, change-password
│   ├── bookings.js             halls, today, my, check-availability, create, cancel
│   └── admin.js                summary, bookings (filterable), users, cancel, toggle
│
├── utils/
│   ├── time.js                  Asia/Kolkata date/time helpers
│   └── bookingId.js             CONF-000001 style code formatting
│
├── public/                      Static frontend (served by Express)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── manifest.json             PWA manifest
│   ├── sw.js                     Service worker (app-shell caching)
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
│
└── database/
    └── conference_booking.db     Created automatically on first run
```

---

## 13. API reference

All endpoints are prefixed with `/api`. Endpoints marked (auth) require a
logged-in session; (admin) additionally require the ADMIN role, both
checked on the server regardless of what the client sends.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /signup | — | Register (starts OTP verification) |
| POST | /verify-email | — | Verify OTP, creates account, logs in |
| POST | /resend-verification | — | Resend a fresh OTP |
| POST | /login | — | Log in with email + password |
| POST | /logout | auth | Log out |
| GET  | /me | auth | Current user info |
| POST | /change-password | auth | Change own password |
| GET  | /halls | auth | List active halls |
| GET  | /bookings/today | auth | Today's schedule for both halls |
| GET  | /bookings/my | auth | Current user's bookings |
| POST | /bookings/check-availability | auth | Check a hall/time slot |
| POST | /bookings | auth | Create a booking |
| POST | /bookings/:id/cancel | auth | Cancel own booking (before start time) |
| GET  | /admin/summary | admin | Dashboard counters |
| GET  | /admin/bookings | admin | All bookings, filterable |
| POST | /admin/bookings/:id/cancel | admin | Cancel any booking, any time |
| GET  | /admin/users | admin | All employees/admins |
| POST | /admin/users/:id/toggle | admin | Activate/deactivate a user |

---

## 14. Security notes

- Passwords and OTPs are bcrypt-hashed; nothing is ever stored in plaintext.
- Sessions are HTTP-only, `SameSite=Lax` cookies, backed by a persistent
  SQLite session store so employees stay logged in across server restarts.
- Set `NODE_ENV=production` when deploying behind HTTPS so cookies get the
  `Secure` flag.
- All SQL uses parameterized queries (`better-sqlite3` prepared statements).
- Role and account-active status are re-read from the database on every
  request — a session can never carry a stale or spoofed role, and a
  deactivated user is locked out immediately, even mid-session.
- Booking date/time rules (today-only, no past times, no overlaps) are
  enforced inside a single synchronous database transaction per booking,
  so two employees booking the same slot at the same moment cannot both
  succeed.

---

## 15. Deployment notes

This app can run on any server that supports Node.js (a VM, a small cloud
instance, or an on-prem server on the company network):

1. Copy the project (excluding `node_modules`, `.env`, and `database/`) to
   the server.
2. Run `npm install --production`.
3. Create `.env` on the server with real `SESSION_SECRET` and SMTP values,
   and `NODE_ENV=production`.
4. Put a reverse proxy (Nginx, Caddy, or similar) in front of Node to
   terminate HTTPS and forward to `http://127.0.0.1:3000`.
5. Run the app with a process manager so it restarts automatically, e.g.
   `pm2 start server.js --name algorisys-booking` or a systemd service.
6. Back up `database/conference_booking.db` regularly — it is the single
   source of truth for every booking and every user account.

For higher load or multiple servers behind a load balancer, migrate the
SQLite database to PostgreSQL (swap `better-sqlite3` for `pg`, and update
the SQL calls in `config/db.js` and `routes/*.js` — the parameterized-query
style used throughout makes this a mechanical port).
