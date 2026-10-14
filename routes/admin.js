const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getIndiaNow, isValidDateString, isValidTimeString } = require('../utils/time');
const { formatBookingCode } = require('../utils/bookingId');
const { sendBookingConfirmationEmail, sendEmployeeWelcomeEmail } = require('../config/mailer');
const { checkEndedMeetings } = require('../utils/meetingWatcher');
const { resolveAttendeeEmails } = require('../utils/attendees');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------
// GET /api/admin/summary
// ---------------------------------------------------------------
router.get('/summary', (req, res) => {
  checkEndedMeetings();
  const { date: today, time: nowTime } = getIndiaNow();

  const todaysBookings = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE booking_date = ?`).get(today).c;
  
  // Current number of meetings which are going on that day (in-progress right now)
  const activeBookings = db.prepare(`
    SELECT COUNT(*) c FROM bookings
    WHERE booking_date = ?
      AND start_time <= ?
      AND end_time > ?
      AND status = 'BOOKED'
      AND concluded_early = 0
  `).get(today, nowTime, nowTime).c;

  const completedBookings = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status = 'COMPLETED'`).get().c;
  const cancelledBookings = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status = 'CANCELLED'`).get().c;
  const totalEmployees = db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'EMPLOYEE'`).get().c;

  res.json({ todaysBookings, activeBookings, completedBookings, cancelledBookings, totalEmployees });
});

// ---------------------------------------------------------------
// GET /api/admin/bookings?date=&hall=&employee=&status=
// ---------------------------------------------------------------
router.get('/bookings', (req, res) => {
  checkEndedMeetings();
  const { date, hall, employee, status } = req.query;

  let sql = `
    SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.end_time, b.purpose, b.attendees, b.participants, b.concluded_early, b.status,
           b.created_at, b.cancelled_at,
           h.name AS hall_name,
           u.full_name AS employee_name, u.email AS employee_email, u.department AS employee_department,
           c.full_name AS cancelled_by_name
    FROM bookings b
    JOIN halls h ON h.id = b.hall_id
    JOIN users u ON u.id = b.user_id
    LEFT JOIN users c ON c.id = b.cancelled_by
    WHERE 1 = 1
  `;
  const params = {};

  if (date && isValidDateString(date)) {
    sql += ' AND b.booking_date = @date';
    params.date = date;
  }
  if (hall) {
    sql += ' AND h.name = @hall';
    params.hall = hall;
  }
  if (employee) {
    sql += ' AND (u.full_name LIKE @employee OR u.email LIKE @employee)';
    params.employee = `%${employee}%`;
  }
  if (status && ['BOOKED', 'CANCELLED', 'COMPLETED'].includes(status.toUpperCase())) {
    sql += ' AND b.status = @status';
    params.status = status.toUpperCase();
  }

  sql += ' ORDER BY b.booking_date DESC, b.start_time DESC, b.id DESC';

  const rows = db.prepare(sql).all(params);
  const { date: today, time: nowTime } = getIndiaNow();

  res.json({
    bookings: rows.map((r) => {
      const isOngoing = (r.status === 'BOOKED' && r.booking_date === today && r.start_time <= nowTime && r.end_time > nowTime && !r.concluded_early);
      return {
        bookingId: r.booking_code,
        date: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        attendees: r.attendees || 1,
        participants: r.participants || '',
        concludedEarly: Boolean(r.concluded_early),
        hall: r.hall_name,
        employeeName: r.employee_name,
        employeeEmail: r.employee_email,
        department: r.employee_department,
        purpose: r.purpose,
        status: r.status,
        isOngoing,
        createdAt: r.created_at,
        cancelledAt: r.cancelled_at,
        cancelledBy: r.cancelled_by_name,
      };
    }),
  });
});

// ---------------------------------------------------------------
// POST /api/admin/bookings (Admin allots meeting for present or future date)
// ---------------------------------------------------------------
router.post('/bookings', (req, res) => {
  try {
    if (!req.body || !req.body.userId || isNaN(Number(req.body.userId)) || Number(req.body.userId) <= 0) {
      return res.status(400).json({ error: 'Please select an employee.' });
    }
    const userId = Number(req.body.userId);

    if (!req.body || !req.body.hallId || isNaN(Number(req.body.hallId)) || Number(req.body.hallId) <= 0) {
      return res.status(400).json({ error: 'Please select a conference hall.' });
    }
    const hallId = Number(req.body.hallId);

    const { date: today, time: nowTime } = getIndiaNow();
    if (!req.body || !req.body.date || !String(req.body.date).trim()) {
      return res.status(400).json({ error: 'Please select a meeting date.' });
    }
    const bookingDate = String(req.body.date).trim();
    const startTime = String((req.body && req.body.startTime) || '').trim();
    const endTime = String((req.body && req.body.endTime) || '').trim();
    const purpose = String((req.body && req.body.purpose) || '').trim();
    const participants = String((req.body && req.body.participants) || '').trim();

    if (!startTime) {
      return res.status(400).json({ error: 'Please enter a start time.' });
    }
    if (!endTime) {
      return res.status(400).json({ error: 'Please enter an end time.' });
    }

    let attendees = parseInt(req.body && req.body.attendees, 10);
    if (isNaN(attendees) || attendees < 1) {
      if (participants) {
        attendees = participants.split(',').map((p) => p.trim()).filter(Boolean).length || 1;
      } else {
        attendees = 1;
      }
    }
    if (attendees < 1) {
      return res.status(400).json({ error: 'Members count must be at least 1.' });
    }
    if (attendees > 100) attendees = 100;

    const hall = db.prepare('SELECT * FROM halls WHERE id = ? AND active = 1').get(hallId);
    if (!hall) return res.status(400).json({ error: 'Please select a valid hall.' });

    const targetUser = db.prepare('SELECT id, full_name, email, department FROM users WHERE id = ?').get(userId);
    if (!targetUser) return res.status(400).json({ error: 'Assigned employee was not found.' });

    if (!isValidDateString(bookingDate)) {
      return res.status(400).json({ error: 'Please enter a valid date.' });
    }
    if (bookingDate < today) {
      return res.status(400).json({ error: 'Cannot allot meeting for a past date.' });
    }
    if (bookingDate === today && startTime < nowTime) {
      return res.status(400).json({ error: 'Start time cannot be in the past for today.' });
    }
    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
      return res.status(400).json({ error: 'Please enter valid times (HH:MM).' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    if (!participants || !participants.trim()) {
      return res.status(400).json({ error: 'Please provide participant names.' });
    }
    if (!purpose || !purpose.trim()) {
      return res.status(400).json({ error: 'Please provide meeting purpose / reason.' });
    }

    const allotBooking = db.transaction(() => {
      const conflict = db.prepare(`
        SELECT start_time, end_time FROM bookings
        WHERE hall_id = @hallId AND booking_date = @date AND status = 'BOOKED'
          AND start_time < @newEnd AND end_time > @newStart
        LIMIT 1
      `).get({ hallId, date: bookingDate, newStart: startTime, newEnd: endTime });

      if (conflict) {
        throw {
          httpStatus: 409,
          message: `${hall.name} is not available on ${bookingDate} from ${startTime} to ${endTime}. Overlap with ${conflict.start_time} - ${conflict.end_time}.`,
        };
      }

      // Check if the assigned employee already has an active booking in ANY hall
      const userOverlap = db.prepare(`
        SELECT b.start_time, b.end_time, h.name AS other_hall_name, b.booking_code
        FROM bookings b
        JOIN halls h ON h.id = b.hall_id
        WHERE b.user_id = @userId AND b.booking_date = @date AND b.status = 'BOOKED'
          AND b.start_time < @newEnd AND b.end_time > @newStart
        LIMIT 1
      `).get({ userId: targetUser.id, date: bookingDate, newStart: startTime, newEnd: endTime });

      if (userOverlap) {
        throw {
          httpStatus: 409,
          message: `${targetUser.full_name} already has an active booking in ${userOverlap.other_hall_name} on ${bookingDate} from ${userOverlap.start_time} to ${userOverlap.end_time}. The same person cannot block both halls for the same time.`,
        };
      }

      const now = new Date().toISOString();
      const info = db.prepare(`
        INSERT INTO bookings (booking_code, user_id, hall_id, booking_date, start_time, end_time, purpose, attendees, participants, status, created_at)
        VALUES ('PENDING', @userId, @hallId, @date, @startTime, @endTime, @purpose, @attendees, @participants, 'BOOKED', @now)
      `).run({ userId: targetUser.id, hallId, date: bookingDate, startTime, endTime, purpose, attendees, participants, now });

      const code = formatBookingCode(info.lastInsertRowid);
      db.prepare('UPDATE bookings SET booking_code = ? WHERE id = ?').run(code, info.lastInsertRowid);

      return { id: info.lastInsertRowid, code, date: bookingDate };
    });

    const result = allotBooking();

    // Resolve attendee emails from participants input (excluding assigned user)
    const resolvedAttendees = resolveAttendeeEmails(participants, targetUser.email);

    // Dispatch email notification to the assigned user and all attendees
    sendBookingConfirmationEmail({
      toEmail: targetUser.email,
      fullName: targetUser.full_name,
      bookingCode: result.code,
      hallName: hall.name,
      date: result.date,
      startTime,
      endTime,
      purpose,
      attendees,
      participants,
      attendeeList: resolvedAttendees,
    }).catch((e) => console.error('Error sending allotment confirmation email:', e.message));

    const attendeeNote = resolvedAttendees.length > 0 
      ? ` and invitations sent to ${resolvedAttendees.length} attendee(s)` 
      : '';

    return res.json({
      message: `Meeting allotted successfully (${result.code}) for ${targetUser.full_name}. Confirmation sent to ${targetUser.email}${attendeeNote}.`,
      bookingId: result.code,
      booking: {
        bookingId: result.code,
        hall: hall.name,
        date: result.date,
        startTime,
        endTime,
        attendees,
        participants,
        purpose,
        employeeName: targetUser.full_name,
        status: 'BOOKED',
      },
    });
  } catch (err) {
    if (err && err.httpStatus) {
      return res.status(err.httpStatus).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong while allotting the meeting.' });
  }
});

// ---------------------------------------------------------------
// POST /api/admin/bookings/:id/cancel  (admin can cancel anytime)
// ---------------------------------------------------------------
router.post('/bookings/:id/cancel', (req, res) => {
  checkEndedMeetings();
  const bookingCode = String(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE booking_code = ?').get(bookingCode);

  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'CANCELLED') {
    return res.status(400).json({ error: 'This booking is already cancelled.' });
  }
  if (booking.status === 'COMPLETED') {
    return res.status(400).json({ error: 'This meeting is already completed and cannot be cancelled.' });
  }

  db.prepare(`
    UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?
    WHERE id = ?
  `).run(new Date().toISOString(), req.user.id, booking.id);

  res.json({ message: 'Booking cancelled successfully.' });
});

// ---------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------
router.get('/users', (req, res) => {
  const rows = db.prepare(`
    SELECT id, full_name, email, department, designation, role, active, must_change_password, created_at
    FROM users
    ORDER BY created_at DESC
  `).all();

  res.json({
    users: rows.map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      department: u.department,
      designation: u.designation || '',
      role: u.role,
      active: Boolean(u.active),
      mustChangePassword: Boolean(u.must_change_password),
      createdAt: u.created_at,
    })),
  });
});

// ---------------------------------------------------------------
// POST /api/admin/users (Admin registers new employee)
// ---------------------------------------------------------------
router.post('/users', (req, res) => {
  try {
    let { fullName, email, department, designation, password, role } = req.body || {};
    fullName = String(fullName || '').trim();
    department = String(department || '').trim();
    designation = String(designation || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');
    role = String(role || 'EMPLOYEE').toUpperCase().trim();

    if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
    if (!department) return res.status(400).json({ error: 'Department is required.' });
    if (!designation) designation = 'Team Member';
    if (!email) return res.status(400).json({ error: 'Company email is required.' });
    const allowAnyEmail = process.env.ALLOW_ANY_EMAIL === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowAnyEmail && !email.endsWith('@algorisys.com')) {
      return res.status(400).json({ error: 'Only @algorisys.com email addresses are allowed in production.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Initial temporary password must be at least 8 characters long.' });
    }
    if (!['EMPLOYEE', 'ADMIN'].includes(role)) {
      role = 'EMPLOYEE';
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(409).json({ error: `An account with email ${email} already exists.` });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();

    const info = db.prepare(`
      INSERT INTO users (full_name, email, department, designation, password_hash, role, verified, active, must_change_password, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, ?)
    `).run(fullName, email, department, designation, passwordHash, role, now);

    const newUser = db.prepare(`
      SELECT id, full_name, email, department, designation, role, active, must_change_password, created_at
      FROM users WHERE id = ?
    `).get(info.lastInsertRowid);

    // Send welcome email with login credentials (asynchronous, non-blocking)
    sendEmployeeWelcomeEmail({
      toEmail: email,
      fullName,
      tempPassword: password,
      department,
      designation,
    }).catch((mailErr) => {
      console.warn('Could not send employee welcome email:', mailErr.message);
    });

    return res.json({
      message: `Employee "${fullName}" successfully registered! They will set a new password on their first login.`,
      user: {
        id: newUser.id,
        fullName: newUser.full_name,
        email: newUser.email,
        department: newUser.department,
        designation: newUser.designation,
        role: newUser.role,
        active: Boolean(newUser.active),
        mustChangePassword: Boolean(newUser.must_change_password),
        createdAt: newUser.created_at,
      },
    });
  } catch (err) {
    console.error('Error creating user by admin:', err);
    return res.status(500).json({ error: 'Failed to create employee account.' });
  }
});

// ---------------------------------------------------------------
// PUT /api/admin/users/:id  (and POST /api/admin/users/:id/edit)
// Edit employee details (name, email, department, designation, role, status, and optional password)
// ---------------------------------------------------------------
function handleEditUser(req, res) {
  try {
    const targetId = Number(req.params.id);
    if (!targetId || isNaN(targetId)) {
      return res.status(400).json({ error: 'Invalid employee ID.' });
    }

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const { fullName, email, department, designation, role, active, password, mustChangePassword } = req.body || {};

    // 1. Validate full name
    const cleanFullName = String(fullName || '').trim();
    if (!cleanFullName) {
      return res.status(400).json({ error: 'Please enter employee full name.' });
    }

    // 2. Validate email
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Please enter company email.' });
    }
    const allowAnyEmailEdit = process.env.ALLOW_ANY_EMAIL === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowAnyEmailEdit && !cleanEmail.endsWith('@algorisys.com')) {
      return res.status(400).json({ error: 'Employee email must end with @algorisys.com in production.' });
    }

    // Check if new email is already taken by another user
    const emailConflict = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(cleanEmail, targetId);
    if (emailConflict) {
      return res.status(409).json({ error: `An account with email ${cleanEmail} already exists for another user.` });
    }

    // 3. Validate department
    const cleanDept = String(department || '').trim();
    if (!cleanDept) {
      return res.status(400).json({ error: 'Please enter department.' });
    }

    const cleanDesignation = String(designation || '').trim();

    // 4. Validate role
    let newRole = target.role;
    if (role !== undefined) {
      newRole = String(role).toUpperCase().trim();
      if (!['ADMIN', 'EMPLOYEE'].includes(newRole)) {
        return res.status(400).json({ error: 'Role must be either ADMIN or EMPLOYEE.' });
      }
      if (targetId === req.user.id && newRole !== 'ADMIN') {
        return res.status(400).json({ error: 'You cannot remove your own Admin rights.' });
      }
      if (target.role === 'ADMIN' && newRole === 'EMPLOYEE') {
        const otherAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'ADMIN' AND id != ?").get(targetId).c;
        if (otherAdmins === 0) {
          return res.status(400).json({ error: 'Cannot demote this user because they are the only remaining Administrator.' });
        }
      }
    }

    // 5. Validate active status
    let newActive = target.active;
    if (active !== undefined) {
      newActive = active ? 1 : 0;
      if (targetId === req.user.id && newActive === 0) {
        return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      }
      if (target.role === 'ADMIN' && newActive === 0) {
        const otherActiveAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'ADMIN' AND active = 1 AND id != ?").get(targetId).c;
        if (otherActiveAdmins === 0) {
          return res.status(400).json({ error: 'Cannot deactivate this user because they are the only active Administrator.' });
        }
      }
    }

    // 6. Handle optional password update
    let newPasswordHash = target.password_hash;
    let newMustChange = target.must_change_password;

    if (password && String(password).trim().length > 0) {
      const cleanPassword = String(password).trim();
      if (cleanPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }
      newPasswordHash = bcrypt.hashSync(cleanPassword, 10);
      newMustChange = mustChangePassword !== undefined ? (mustChangePassword ? 1 : 0) : 1;
    } else if (mustChangePassword !== undefined) {
      newMustChange = mustChangePassword ? 1 : 0;
    }

    // 7. Update user record in database
    db.prepare(`
      UPDATE users 
      SET full_name = ?, email = ?, department = ?, designation = ?, role = ?, active = ?, password_hash = ?, must_change_password = ?
      WHERE id = ?
    `).run(cleanFullName, cleanEmail, cleanDept, cleanDesignation, newRole, newActive, newPasswordHash, newMustChange, targetId);

    const updatedUser = db.prepare(`
      SELECT id, full_name, email, department, designation, role, active, must_change_password, created_at
      FROM users WHERE id = ?
    `).get(targetId);

    return res.json({
      message: `Employee "${cleanFullName}" details updated successfully.`,
      user: {
        id: updatedUser.id,
        fullName: updatedUser.full_name,
        email: updatedUser.email,
        department: updatedUser.department,
        designation: updatedUser.designation,
        role: updatedUser.role,
        active: Boolean(updatedUser.active),
        mustChangePassword: Boolean(updatedUser.must_change_password),
        createdAt: updatedUser.created_at,
      },
    });
  } catch (err) {
    console.error('Error updating employee details:', err);
    return res.status(500).json({ error: 'Failed to update employee details.' });
  }
}

router.put('/users/:id', handleEditUser);
router.post('/users/:id/edit', handleEditUser);
router.post('/users/:id/update', handleEditUser);

// ---------------------------------------------------------------
// POST /api/admin/users/:id/toggle  (activate/deactivate)
// ---------------------------------------------------------------
router.post('/users/:id/toggle', (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own currently logged-in account.' });
  }

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const newActive = target.active ? 0 : 1;
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(newActive, targetId);

  res.json({ message: newActive ? 'User activated.' : 'User deactivated.', active: Boolean(newActive) });
});

// ---------------------------------------------------------------
// POST /api/admin/users/:id/role  (change user role: ADMIN or EMPLOYEE)
// ---------------------------------------------------------------
router.post('/users/:id/role', (req, res) => {
  const targetId = Number(req.params.id);
  const newRole = String(req.body && req.body.role || '').toUpperCase().trim();

  if (!['ADMIN', 'EMPLOYEE'].includes(newRole)) {
    return res.status(400).json({ error: 'Role must be either ADMIN or EMPLOYEE.' });
  }

  const target = db.prepare('SELECT id, full_name, email, role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  if (targetId === req.user.id && newRole !== 'ADMIN') {
    return res.status(400).json({ error: 'You cannot remove your own Admin rights.' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetId);

  res.json({
    message: `Role for ${target.full_name} (${target.email}) updated to ${newRole}.`,
    user: { id: target.id, role: newRole },
  });
});

// ---------------------------------------------------------------
// DELETE /api/admin/users/:id  (permanently delete employee from database)
// Also supports POST /api/admin/users/:id/delete for client compatibility
// ---------------------------------------------------------------
function handleDeleteUser(req, res) {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove your own currently logged-in account from the database.' });
  }

  const target = db.prepare('SELECT id, full_name, email, role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Employee not found in the database.' });

  if (target.role === 'ADMIN') {
    const otherAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'ADMIN' AND id != ?").get(targetId).c;
    if (otherAdmins === 0) {
      return res.status(400).json({ error: 'Cannot remove this user because they are the only remaining Administrator.' });
    }
  }

  try {
    const removeEmployee = db.transaction(() => {
      // 1. Delete all bookings made by this user (frees rooms immediately)
      db.prepare('DELETE FROM bookings WHERE user_id = ?').run(targetId);
      // 2. Clear cancelled_by reference if this user cancelled any booking
      db.prepare('UPDATE bookings SET cancelled_by = NULL WHERE cancelled_by = ?').run(targetId);
      // 3. Remove any pending email verification records
      db.prepare('DELETE FROM email_verifications WHERE email = ?').run(target.email);
      // 4. Remove any pending password reset records
      db.prepare('DELETE FROM password_resets WHERE email = ?').run(target.email);
      // 5. Delete the user from users table
      db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    });

    removeEmployee();

    res.json({
      message: `Employee ${target.full_name} (${target.email}) has been permanently removed from the database.`,
      deletedUserId: targetId,
    });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: 'Failed to remove employee from the database.' });
  }
}

router.delete('/users/:id', handleDeleteUser);
router.post('/users/:id/delete', handleDeleteUser);

module.exports = router;
