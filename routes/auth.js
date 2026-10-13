const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { sendOtpEmail, sendPasswordResetOtpEmail, isSmtpConfigured } = require('../config/mailer');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const COMPANY_DOMAIN = '@algorisys.com';
const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Exact-domain check. Rejects subdomains like @mail.algorisys.com.
function isCompanyEmail(email) {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at);
  return domain === COMPANY_DOMAIN;
}

function generateOtp() {
  // Cryptographically random 6-digit code, always 6 characters (no leading-zero loss)
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    department: user.department,
    designation: user.designation || '',
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

function loginSession(req, user, res, callback) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start session.' });
    req.session.userId = user.id;
    callback();
  });
}

// ---------------------------------------------------------------
// POST /api/signup (Self-registration disabled - Accounts created by Admin)
// ---------------------------------------------------------------
router.post('/signup', async (req, res) => {
  return res.status(403).json({
    error: 'Employee self-registration is disabled. All employee accounts are created by the System Administrator. Please contact your administrator to receive your login credentials.',
  });
});

// ---------------------------------------------------------------
// POST /api/verify-email
// ---------------------------------------------------------------
router.post('/verify-email', (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const otp = String((req.body && req.body.otp) || '').trim();

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required.' });
    }

    const record = db.prepare('SELECT * FROM email_verifications WHERE email = ?').get(email);
    if (!record) {
      return res.status(404).json({ error: 'No pending verification found for this email. Please register again.' });
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM email_verifications WHERE id = ?').run(record.id);
      return res.status(410).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      db.prepare('DELETE FROM email_verifications WHERE id = ?').run(record.id);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
    }

    const matches = bcrypt.compareSync(otp, record.otp_hash);
    if (!matches) {
      db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({
        error: remaining > 0
          ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
          : 'Incorrect verification code. No attempts remaining.',
      });
    }

    // Double-check no account was created in the meantime (race safety)
    const already = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (already) {
      db.prepare('DELETE FROM email_verifications WHERE id = ?').run(record.id);
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO users (full_name, email, department, password_hash, role, verified, active, created_at)
      VALUES (?, ?, ?, ?, 'EMPLOYEE', 1, 1, ?)
    `).run(record.full_name, email, record.department, record.password_hash, now);

    db.prepare('DELETE FROM email_verifications WHERE id = ?').run(record.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

    loginSession(req, user, res, () => {
      return res.json({ message: 'Email verified. Account created successfully.', user: publicUser(user) });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong during verification.' });
  }
});

// ---------------------------------------------------------------
// POST /api/resend-verification
// ---------------------------------------------------------------
router.post('/resend-verification', async (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const record = db.prepare('SELECT * FROM email_verifications WHERE email = ?').get(email);
    if (!record) {
      return res.status(404).json({ error: 'No pending verification found for this email. Please register again.' });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const smtpConfigured = isSmtpConfigured();

    if (!smtpConfigured && !isDev) {
      return res.status(503).json({ error: 'Email service is not configured on the server. Contact your administrator.' });
    }

    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE email_verifications
      SET otp_hash = ?, expires_at = ?, attempts = 0
      WHERE id = ?
    `).run(otpHash, expiresAt, record.id);

    let sent = false;
    if (smtpConfigured) {
      try {
        await sendOtpEmail(email, record.full_name, otp);
        sent = true;
      } catch (mailErr) {
        console.error('Failed to resend OTP email:', mailErr.message);
        if (!isDev) {
          return res.status(502).json({ error: 'Could not send verification email. Please try again later.' });
        }
      }
    }

    if (!sent && isDev) {
      console.log('====================================================');
      console.log(`[DEV MODE] Resent Verification OTP for ${record.full_name} (${email}): ${otp}`);
      console.log('====================================================');
      return res.json({
        message: `Dev Mode: New verification code is ${otp}`,
        devOtp: otp,
      });
    }

    return res.json({ message: 'A new verification code has been sent to your company email.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong while resending the code.' });
  }
});

// ---------------------------------------------------------------
// POST /api/login
// ---------------------------------------------------------------
router.post('/login', (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact administrator.' });
    }

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    loginSession(req, user, res, () => {
      return res.json({ message: 'Login successful.', user: publicUser(user) });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong during login.' });
  }
});

// ---------------------------------------------------------------
// POST /api/logout
// ---------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out.' });
  });
});

// ---------------------------------------------------------------
// GET /api/me
// ---------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------
// POST /api/change-password  (any logged-in user, including admin)
// ---------------------------------------------------------------
router.post('/change-password', requireAuth, (req, res) => {
  const currentPassword = String((req.body && req.body.currentPassword) || '');
  const newPassword = String((req.body && req.body.newPassword) || '');
  const confirmNewPassword = String((req.body && req.body.confirmNewPassword) || '');

  if (!bcrypt.compareSync(currentPassword, req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }
  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  res.json({ message: 'Password changed successfully.' });
});

// ---------------------------------------------------------------
// POST /api/first-time-password (First-time login: create new permanent password)
// ---------------------------------------------------------------
router.post('/first-time-password', requireAuth, (req, res) => {
  try {
    const newPassword = String((req.body && req.body.newPassword) || '');
    const confirmNewPassword = String((req.body && req.body.confirmNewPassword) || '');

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ error: 'New password and confirmation do not match.' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(newHash, req.user.id);

    req.user.must_change_password = 0;
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    return res.json({
      message: 'New password set successfully! Welcome to Algorisys Conference Suite.',
      user: publicUser(updatedUser),
    });
  } catch (err) {
    console.error('Error updating first-time password:', err);
    return res.status(500).json({ error: 'Could not update password. Please try again.' });
  }
});

// ---------------------------------------------------------------
// POST /api/forgot-password (request 6-digit OTP code for password reset)
// ---------------------------------------------------------------
router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);

    if (!email) {
      return res.status(400).json({ error: 'Company email is required.' });
    }
    if (!isCompanyEmail(email)) {
      return res.status(400).json({ error: 'Only @algorisys.com email addresses are allowed.' });
    }

    const user = db.prepare('SELECT id, full_name, email, active FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'No account registered with this email address.' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact an administrator.' });
    }

    const smtpConfigured = isSmtpConfigured();
    if (!smtpConfigured) {
      return res.status(503).json({
        error: 'Email service is not configured. Please add your SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) in the Render Dashboard (Environment tab) to send verification codes.',
      });
    }

    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Replace any previous reset requests for this email
    db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);
    db.prepare(`
      INSERT INTO password_resets (email, otp_hash, expires_at, attempts, created_at)
      VALUES (?, ?, ?, 0, ?)
    `).run(email, otpHash, expiresAt, now);

    try {
      await sendPasswordResetOtpEmail(email, user.full_name, otp);
    } catch (mailErr) {
      console.error('Failed to send password reset email:', mailErr.message);
      db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);
      return res.status(502).json({
        error: `Could not send email: ${mailErr.message}. Please check your Gmail SMTP settings in .env.`,
      });
    }

    return res.json({ message: `Verification code sent to ${email}. Please check your inbox.`, email });
  } catch (err) {
    console.error('Error in forgot-password:', err);
    return res.status(500).json({ error: 'Something went wrong while processing your request.' });
  }
});

// ---------------------------------------------------------------
// POST /api/resend-forgot-password
// ---------------------------------------------------------------
router.post('/resend-forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const user = db.prepare('SELECT id, full_name, email, active FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'No account registered with this email address.' });
    }

    const record = db.prepare('SELECT * FROM password_resets WHERE email = ?').get(email);
    if (!record) {
      return res.status(404).json({ error: 'No pending password reset found. Please submit a request first.' });
    }

    const smtpConfigured = isSmtpConfigured();
    if (!smtpConfigured) {
      return res.status(503).json({ error: 'Email service is not configured yet. Please configure your Gmail SMTP settings in .env.' });
    }

    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE password_resets
      SET otp_hash = ?, expires_at = ?, attempts = 0
      WHERE id = ?
    `).run(otpHash, expiresAt, record.id);

    try {
      await sendPasswordResetOtpEmail(email, user.full_name, otp);
    } catch (mailErr) {
      console.error('Failed to resend reset email:', mailErr.message);
      return res.status(502).json({ error: `Could not send verification email: ${mailErr.message}.` });
    }

    return res.json({ message: 'A new verification code has been sent to your email inbox.' });
  } catch (err) {
    console.error('Error in resend-forgot-password:', err);
    return res.status(500).json({ error: 'Something went wrong while resending the code.' });
  }
});

// ---------------------------------------------------------------
// POST /api/reset-password (verify code & set new password)
// ---------------------------------------------------------------
router.post('/reset-password', (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const otp = String((req.body && req.body.otp) || '').trim();
    const password = String((req.body && req.body.password) || '');
    const confirmPassword = String((req.body && req.body.confirmPassword) || '');

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'New password and Confirm Password do not match.' });
    }

    const user = db.prepare('SELECT id, full_name, email, active FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact an administrator.' });
    }

    const record = db.prepare('SELECT * FROM password_resets WHERE email = ?').get(email);
    if (!record) {
      return res.status(404).json({ error: 'No pending password reset request found for this email. Please request a new code.' });
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM password_resets WHERE id = ?').run(record.id);
      return res.status(410).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      db.prepare('DELETE FROM password_resets WHERE id = ?').run(record.id);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
    }

    const matches = bcrypt.compareSync(otp, record.otp_hash);
    if (!matches) {
      db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({
        error: remaining > 0
          ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
          : 'Incorrect verification code. No attempts remaining.',
      });
    }

    const newHash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    db.prepare('DELETE FROM password_resets WHERE id = ?').run(record.id);

    return res.json({
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (err) {
    console.error('Error in reset-password:', err);
    return res.status(500).json({ error: 'Something went wrong while resetting your password.' });
  }
});

module.exports = router;

