const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, '..', 'database');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'conference_booking.db');
const db = new Database(DB_PATH);

// Reasonable safe defaults for a small multi-user SQLite deployment
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  department    TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK (role IN ('ADMIN','EMPLOYEE')),
  verified      INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS halls (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_code TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  hall_id      INTEGER NOT NULL REFERENCES halls(id),
  booking_date TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  attendees    INTEGER NOT NULL DEFAULT 1,
  end_notified INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','CANCELLED','COMPLETED')),
  created_at   TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_hall_date ON bookings(hall_id, booking_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);

CREATE TABLE IF NOT EXISTS email_verifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  department    TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  otp_hash      TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  otp_hash      TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
`);

// Safe migrations for existing databases
const bookingColumns = db.prepare(`PRAGMA table_info(bookings)`).all().map((c) => c.name);
if (!bookingColumns.includes('attendees')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN attendees INTEGER NOT NULL DEFAULT 1`);
}
if (!bookingColumns.includes('participants')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN participants TEXT DEFAULT ''`);
}
if (!bookingColumns.includes('concluded_early')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN concluded_early INTEGER NOT NULL DEFAULT 0`);
}
if (!bookingColumns.includes('end_notified')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN end_notified INTEGER NOT NULL DEFAULT 0`);
}

// ---- Seed halls (exactly two, only if not already present) ----
const hallCount = db.prepare('SELECT COUNT(*) AS c FROM halls').get().c;
if (hallCount === 0) {
  const insertHall = db.prepare('INSERT INTO halls (name, active) VALUES (?, 1)');
  insertHall.run('Board Room');
  insertHall.run('Small Conference Room');
  console.log('[db] Seeded halls: Board Room, Small Conference Room');
}

// ---- Seed initial admin (only if NO users exist at all) ----
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const defaultPassword = 'Admin@12345';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare(`
    INSERT INTO users (full_name, email, department, password_hash, role, verified, active, created_at)
    VALUES (?, ?, ?, ?, 'ADMIN', 1, 1, ?)
  `).run('System Administrator', 'admin@algorisys.com', 'Administration', hash, new Date().toISOString());

  console.log('=================================================================');
  console.log('[db] First run detected. Default admin account created:');
  console.log('     Email:    admin@algorisys.com');
  console.log('     Password: Admin@12345');
  console.log('     >>> CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN <<<');
  console.log('=================================================================');
}

module.exports = db;
