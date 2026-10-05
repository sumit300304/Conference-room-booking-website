require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

// Initializing this creates/opens the DB, applies schema, and seeds halls + first admin.
require('./config/db');

const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET is not set in the environment. Using an insecure fallback for this run only.');
}

app.disable('x-powered-by');

// Allow local development frontends (e.g. Live Server on port 5500 or port 3000)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '100kb' }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'database') }),
  name: 'algorisys.sid',
  secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION, // requires HTTPS in production
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ---- API routes ----
app.use('/api', authRoutes);
app.use('/api', bookingRoutes);
app.use('/api/admin', adminRoutes);

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Fallback error handler ----
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

const { startMeetingWatcher } = require('./utils/meetingWatcher');

app.listen(PORT, () => {
  console.log(`Algorisys Conference Hall Booking running at http://localhost:${PORT}`);
  startMeetingWatcher();
});
