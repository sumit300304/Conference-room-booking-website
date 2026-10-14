const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getIndiaNow, isValidTimeString, isValidDateString } = require('../utils/time');
const { formatBookingCode } = require('../utils/bookingId');
const { sendBookingConfirmationEmail, sendMeetingEndedEmail } = require('../config/mailer');
const { checkEndedMeetings } = require('../utils/meetingWatcher');
const { resolveAttendeeEmails, validateAttendees } = require('../utils/attendees');

const router = express.Router();

const MAX_PURPOSE_LENGTH = 300;

function getActiveHalls() {
  return db.prepare('SELECT id, name FROM halls WHERE active = 1 ORDER BY id').all();
}

function getHallById(hallId) {
  return db.prepare('SELECT * FROM halls WHERE id = ? AND active = 1').get(hallId);
}

// ---------------------------------------------------------------
// GET /api/colleagues
// Returns active company colleagues for autocomplete / participant selection
// ---------------------------------------------------------------
router.get('/colleagues', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, full_name, email, department FROM users WHERE active = 1 ORDER BY full_name').all();
  res.json({
    colleagues: users.map((u) => ({
      id: u.id,
      name: u.full_name,
      email: u.email,
      department: u.department,
    })),
  });
});

// ---------------------------------------------------------------
// GET /api/halls
// ---------------------------------------------------------------
router.get('/halls', requireAuth, (req, res) => {
  res.json({ halls: getActiveHalls() });
});

// ---------------------------------------------------------------
// GET /api/bookings/schedule?date=YYYY-MM-DD
// Shows both halls' schedule for the requested date (or today by default).
// ---------------------------------------------------------------
router.get('/bookings/schedule', requireAuth, (req, res) => {
  checkEndedMeetings();
  const indiaNow = getIndiaNow();
  let requestedDate = req.query.date ? String(req.query.date).trim() : indiaNow.date;
  
  if (!isValidDateString(requestedDate)) {
    requestedDate = indiaNow.date;
  }

  const halls = getActiveHalls();

  const rows = db.prepare(`
    SELECT b.hall_id, b.start_time, b.end_time, b.user_id, b.attendees, b.participants, b.purpose, b.concluded_early, b.status,
           u.full_name AS booker_name
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.booking_date = ? AND b.status IN ('BOOKED', 'COMPLETED')
    ORDER BY b.start_time
  `).all(requestedDate);

  const schedule = halls.map((hall) => ({
    hallId: hall.id,
    hallName: hall.name,
    bookings: rows
      .filter((r) => r.hall_id === hall.id)
      .map((r) => ({
        startTime: r.start_time,
        endTime: r.end_time,
        attendees: r.attendees || 1,
        participants: r.participants || '',
        purpose: r.purpose || '',
        bookerName: r.booker_name || '',
        concludedEarly: Boolean(r.concluded_early),
        isMine: r.user_id === req.user.id,
        userId: r.user_id,
        status: r.status,
      })),
  }));

  res.json({
    date: requestedDate,
    today: indiaNow.date,
    currentTime: indiaNow.time,
    isToday: requestedDate === indiaNow.date,
    isFuture: requestedDate > indiaNow.date,
    schedule,
  });
});

// Backward compatibility alias for /bookings/today
router.get('/bookings/today', requireAuth, (req, res) => {
  checkEndedMeetings();
  const indiaNow = getIndiaNow();
  const halls = getActiveHalls();

  const rows = db.prepare(`
    SELECT hall_id, start_time, end_time, user_id, attendees, participants, concluded_early, status
    FROM bookings
    WHERE booking_date = ? AND status IN ('BOOKED', 'COMPLETED')
    ORDER BY start_time
  `).all(indiaNow.date);

  const schedule = halls.map((hall) => ({
    hallId: hall.id,
    hallName: hall.name,
    bookings: rows
      .filter((r) => r.hall_id === hall.id)
      .map((r) => ({
        startTime: r.start_time,
        endTime: r.end_time,
        attendees: r.attendees || 1,
        participants: r.participants || '',
        concludedEarly: Boolean(r.concluded_early),
        status: r.status,
        isMine: r.user_id === req.user.id,
      })),
  }));

  res.json({ date: indiaNow.date, currentTime: indiaNow.time, schedule });
});

// ---------------------------------------------------------------
// GET /api/bookings/my
// ---------------------------------------------------------------
router.get('/bookings/my', requireAuth, (req, res) => {
  checkEndedMeetings();
  const rows = db.prepare(`
    SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.end_time,
           b.purpose, b.attendees, b.participants, b.concluded_early, b.status, b.created_at, b.cancelled_at, h.name AS hall_name
    FROM bookings b
    JOIN halls h ON h.id = b.hall_id
    WHERE b.user_id = ?
    ORDER BY b.booking_date DESC, b.start_time DESC, b.id DESC
  `).all(req.user.id);

  const { date: today, time: nowTime } = getIndiaNow();

  const bookings = rows.map((r) => {
    let canCancel = false;
    let canFreeRoom = false;

    if (r.status === 'BOOKED') {
      if (r.booking_date > today) {
        canCancel = true; // Future booking: can cancel anytime before start
      } else if (r.booking_date === today) {
        if (nowTime < r.start_time) {
          canCancel = true; // Today before start: can cancel
        } else if (nowTime >= r.start_time && nowTime < r.end_time) {
          canFreeRoom = true; // Today ongoing: can conclude early and free the room!
        }
      }
    }

    return {
      bookingId: r.booking_code,
      date: r.booking_date,
      hall: r.hall_name,
      startTime: r.start_time,
      endTime: r.end_time,
      attendees: r.attendees || 1,
      participants: r.participants || '',
      concludedEarly: Boolean(r.concluded_early),
      purpose: r.purpose,
      status: r.status,
      isOngoing: canFreeRoom,
      createdAt: r.created_at,
      cancelledAt: r.cancelled_at,
      canCancel,
      canFreeRoom,
      dbId: r.id,
    };
  });

  res.json({ bookings });
});

// ---------------------------------------------------------------
// POST /api/bookings/check-availability
// body: { hallId, date, startTime, endTime }
// ---------------------------------------------------------------
router.post('/bookings/check-availability', requireAuth, (req, res) => {
  const hallId = Number(req.body && req.body.hallId);
  const startTime = String((req.body && req.body.startTime) || '').trim();
  const endTime = String((req.body && req.body.endTime) || '').trim();
  const { date: today, time: nowTime } = getIndiaNow();
  const date = String((req.body && req.body.date) || today).trim();

  const hall = getHallById(hallId);
  if (!hall) return res.status(400).json({ error: 'Please select a valid hall.' });

  if (!isValidDateString(date)) {
    return res.status(400).json({ error: 'Please select a valid date (YYYY-MM-DD).' });
  }

  if (date < today) {
    return res.status(400).json({ error: 'You cannot select a past date. Please pick today or a future date.' });
  }

  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
    return res.status(400).json({ error: 'Please enter valid start and end times.' });
  }
  if (startTime >= endTime) {
    return res.status(400).json({ error: 'End time must be after start time.' });
  }

  // If booking for today, start time cannot be in the past. If future date, no restriction.
  if (date === today && startTime < nowTime) {
    return res.status(400).json({ error: `Start time cannot be in the past for today's booking. Current time is ${nowTime} IST.` });
  }

  const conflictRows = db.prepare(`
    SELECT start_time, end_time FROM bookings
    WHERE hall_id = @hallId AND booking_date = @date AND status = 'BOOKED'
      AND start_time < @newEnd AND end_time > @newStart
    ORDER BY start_time
  `).all({ hallId, date, newStart: startTime, newEnd: endTime });

  const userOverlap = db.prepare(`
    SELECT b.start_time, b.end_time, h.name AS other_hall_name
    FROM bookings b
    JOIN halls h ON h.id = b.hall_id
    WHERE b.user_id = @userId AND b.booking_date = @date AND b.status = 'BOOKED'
      AND b.start_time < @newEnd AND b.end_time > @newStart
    LIMIT 1
  `).get({ userId: req.user.id, date, newStart: startTime, newEnd: endTime });

  const available = conflictRows.length === 0 && !userOverlap;

  res.json({
    hall: hall.name,
    date,
    startTime,
    endTime,
    available,
    userConflict: userOverlap ? {
      hall: userOverlap.other_hall_name,
      startTime: userOverlap.start_time,
      endTime: userOverlap.end_time,
    } : null,
    conflicts: conflictRows.map((c) => ({ startTime: c.start_time, endTime: c.end_time })),
  });
});

// ---------------------------------------------------------------
// POST /api/bookings
// body: { hallId, date, startTime, endTime, purpose, attendees, participants }
// ---------------------------------------------------------------
router.post('/bookings', requireAuth, async (req, res) => {
  try {
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

    const hall = getHallById(hallId);
    if (!hall) return res.status(400).json({ error: 'Please select a valid hall.' });

    if (!isValidDateString(bookingDate)) {
      return res.status(400).json({ error: 'Please select a valid date (YYYY-MM-DD).' });
    }

    if (bookingDate < today) {
      return res.status(400).json({ error: 'You cannot book a conference hall for a past date. Please pick today or a future date.' });
    }

    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
      return res.status(400).json({ error: 'Please enter valid start and end times (HH:MM).' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    if (!participants || !participants.trim()) {
      return res.status(400).json({ error: 'Please select meeting attendees from the registered employees dropdown.' });
    }

    // Strict validation: Every attendee must be an active registered employee in the database
    const attendeeValidation = validateAttendees(participants);
    if (!attendeeValidation.valid) {
      return res.status(400).json({ error: attendeeValidation.error });
    }

    const canonicalParticipants = attendeeValidation.users.map((u) => u.full_name).join(', ');
    if (isNaN(attendees) || attendees < 1) {
      attendees = Math.max(1, attendeeValidation.users.length);
    }

    if (!purpose || !purpose.trim()) {
      return res.status(400).json({ error: 'Please provide meeting purpose / agenda.' });
    }
    if (purpose.length > MAX_PURPOSE_LENGTH) {
      return res.status(400).json({ error: `Purpose must be ${MAX_PURPOSE_LENGTH} characters or fewer.` });
    }

    // Past time check strictly only applies if booking is for TODAY
    if (bookingDate === today && startTime < nowTime) {
      return res.status(400).json({ error: `Start time cannot be in the past for today's date. Current time is ${nowTime} IST.` });
    }

    // Atomic transaction: conflict check + insertion
    const createBooking = db.transaction(() => {
      const { date: txToday, time: txTime } = getIndiaNow();
      if (bookingDate < txToday) {
        throw { httpStatus: 400, message: 'You cannot book a conference hall for a past date.' };
      }
      if (bookingDate === txToday && startTime < txTime) {
        throw { httpStatus: 400, message: 'Start time cannot be in the past for today.' };
      }

      const conflict = db.prepare(`
        SELECT start_time, end_time FROM bookings
        WHERE hall_id = @hallId AND booking_date = @date AND status = 'BOOKED'
          AND start_time < @newEnd AND end_time > @newStart
        LIMIT 1
      `).get({ hallId, date: bookingDate, newStart: startTime, newEnd: endTime });

      if (conflict) {
        throw {
          httpStatus: 409,
          message: `${hall.name} is not available on ${bookingDate} from ${startTime} to ${endTime}. Conflicting slot: ${conflict.start_time} - ${conflict.end_time}.`,
        };
      }

      // Check if the same person already has a booking in ANY hall for this time
      const userOverlap = db.prepare(`
        SELECT b.start_time, b.end_time, h.name AS other_hall_name, b.booking_code
        FROM bookings b
        JOIN halls h ON h.id = b.hall_id
        WHERE b.user_id = @userId AND b.booking_date = @date AND b.status = 'BOOKED'
          AND b.start_time < @newEnd AND b.end_time > @newStart
        LIMIT 1
      `).get({ userId: req.user.id, date: bookingDate, newStart: startTime, newEnd: endTime });

      if (userOverlap) {
        throw {
          httpStatus: 409,
          message: `You already have an active booking in ${userOverlap.other_hall_name} on ${bookingDate} from ${userOverlap.start_time} to ${userOverlap.end_time}. The same person cannot block both halls for the same time.`,
        };
      }

      const now = new Date().toISOString();
      const info = db.prepare(`
        INSERT INTO bookings (booking_code, user_id, hall_id, booking_date, start_time, end_time, purpose, attendees, participants, status, created_at)
        VALUES ('PENDING', @userId, @hallId, @date, @startTime, @endTime, @purpose, @attendees, @participants, 'BOOKED', @now)
      `).run({ userId: req.user.id, hallId, date: bookingDate, startTime, endTime, purpose, attendees, participants: canonicalParticipants, now });

      const code = formatBookingCode(info.lastInsertRowid);
      db.prepare('UPDATE bookings SET booking_code = ? WHERE id = ?').run(code, info.lastInsertRowid);

      return { id: info.lastInsertRowid, code, date: bookingDate };
    });

    const result = createBooking();

    // Resolve attendee emails from validated registered users (excluding booker to prevent duplicate email)
    const bookerEmailLower = (req.user.email || '').toLowerCase().trim();
    const resolvedAttendees = attendeeValidation.users
      .filter((u) => u.email.toLowerCase().trim() !== bookerEmailLower)
      .map((u) => ({
        id: u.id,
        name: u.full_name,
        email: u.email,
        department: u.department || '',
      }));

    // Send confirmation email notification to the booking employee and all attendees
    sendBookingConfirmationEmail({
      toEmail: req.user.email,
      fullName: req.user.full_name || req.user.fullName || 'Colleague',
      bookingCode: result.code,
      hallName: hall.name,
      date: result.date,
      startTime,
      endTime,
      purpose,
      attendees,
      participants: canonicalParticipants,
      attendeeList: resolvedAttendees,
    }).catch((err) => console.error('Error dispatching confirmation email:', err.message));

    const attendeeNote = resolvedAttendees.length > 0 
      ? ` and invitations sent to ${resolvedAttendees.length} attendee(s)` 
      : '';

    return res.json({
      message: `Booking confirmed successfully. Confirmation sent to your registered email (${req.user.email})${attendeeNote}.`,
      booking: {
        bookingId: result.code,
        hall: hall.name,
        date: result.date,
        startTime,
        endTime,
        attendees,
        participants,
        purpose,
        status: 'BOOKED',
      },
    });
  } catch (err) {
    if (err && err.httpStatus) {
      return res.status(err.httpStatus).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong while creating the booking.' });
  }
});

// ---------------------------------------------------------------
// POST /api/bookings/:id/end-early  (Free room early if meeting ends ahead of time)
// ---------------------------------------------------------------
router.post('/bookings/:id/end-early', requireAuth, (req, res) => {
  try {
    const bookingCode = String(req.params.id);
    const booking = db.prepare(`
      SELECT b.*, h.name AS hall_name, u.email, u.full_name
      FROM bookings b
      JOIN halls h ON h.id = b.hall_id
      JOIN users u ON u.id = b.user_id
      WHERE b.booking_code = ?
    `).get(bookingCode);

    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const isOwner = booking.user_id === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only release your own active bookings.' });
    }

    if (booking.status !== 'BOOKED') {
      return res.status(400).json({ error: 'This booking is not currently active.' });
    }

    const { date: today, time: nowTime } = getIndiaNow();

    if (booking.booking_date !== today) {
      return res.status(400).json({ error: 'You can only release meetings taking place today.' });
    }

    if (nowTime < booking.start_time) {
      return res.status(400).json({ error: 'This meeting has not started yet. Use Cancel instead.' });
    }

    if (nowTime >= booking.end_time) {
      return res.status(400).json({ error: 'This meeting scheduled time has already concluded.' });
    }

    // Update end_time to current time! This frees all subsequent minutes immediately!
    db.prepare(`
      UPDATE bookings
      SET end_time = ?, concluded_early = 1, end_notified = 1, status = 'COMPLETED'
      WHERE id = ?
    `).run(nowTime, booking.id);

    // Notify employee that meeting ended early and room is released
    sendMeetingEndedEmail({
      toEmail: booking.email,
      fullName: booking.full_name,
      bookingCode: booking.booking_code,
      hallName: booking.hall_name,
      date: booking.booking_date,
      startTime: booking.start_time,
      endTime: nowTime,
      purpose: `${booking.purpose} (Concluded early at ${nowTime} IST)`,
    }).catch((e) => console.error('Error dispatching early conclusion email:', e.message));

    return res.json({
      message: `${booking.hall_name} has been released at ${nowTime} IST. The room is now available for other colleagues!`,
      newEndTime: nowTime,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while concluding the meeting early.' });
  }
});

// ---------------------------------------------------------------
// POST /api/bookings/:id/cancel  (employee cancels own booking before start)
// ---------------------------------------------------------------
router.post('/bookings/:id/cancel', requireAuth, (req, res) => {
  try {
    checkEndedMeetings();
    const bookingCode = String(req.params.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE booking_code = ?').get(bookingCode);

    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.user_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only cancel your own bookings.' });
    }
    if (booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'This booking is already cancelled.' });
    }
    if (booking.status === 'COMPLETED') {
      return res.status(400).json({ error: 'This meeting is already completed and cannot be cancelled.' });
    }

    const { date: today, time: nowTime } = getIndiaNow();
    if (booking.booking_date < today) {
      return res.status(400).json({ error: 'Cannot cancel a past booking.' });
    }
    if (booking.booking_date === today && nowTime >= booking.start_time) {
      return res.status(400).json({ error: 'Meeting has already started. If concluded, use "Free Room Now" to release it early.' });
    }

    db.prepare(`
      UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?
      WHERE id = ?
    `).run(new Date().toISOString(), req.user.id, booking.id);

    res.json({ message: 'Booking cancelled successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while cancelling the booking.' });
  }
});

module.exports = router;
