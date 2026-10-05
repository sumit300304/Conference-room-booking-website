const db = require('../config/db');
const { getIndiaNow } = require('./time');
const { sendMeetingEndedEmail } = require('../config/mailer');

function checkEndedMeetings() {
  try {
    const { date: today, time: nowTime } = getIndiaNow();

    // 1. Mark meetings as COMPLETED if their scheduled time has ended
    db.prepare(`
      UPDATE bookings
      SET status = 'COMPLETED'
      WHERE status = 'BOOKED'
        AND (concluded_early = 1 OR booking_date < ? OR (booking_date = ? AND end_time <= ?))
    `).run(today, today, nowTime);

    // 2. Send meeting ended notification email if not already sent
    const endedBookings = db.prepare(`
      SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.end_time, b.purpose,
             h.name AS hall_name, u.email, u.full_name
      FROM bookings b
      JOIN halls h ON h.id = b.hall_id
      JOIN users u ON u.id = b.user_id
      WHERE b.status = 'COMPLETED' AND b.end_notified = 0
    `).all();

    for (const b of endedBookings) {
      db.prepare('UPDATE bookings SET end_notified = 1 WHERE id = ?').run(b.id);

      sendMeetingEndedEmail({
        toEmail: b.email,
        fullName: b.full_name,
        bookingCode: b.booking_code,
        hallName: b.hall_name,
        date: b.booking_date,
        startTime: b.start_time,
        endTime: b.end_time,
        purpose: b.purpose,
      }).catch((e) => console.error('Error sending meeting ended notification:', e.message));
    }
  } catch (err) {
    console.error('Error in checkEndedMeetings watcher:', err.message);
  }
}

function startMeetingWatcher() {
  checkEndedMeetings();
  setInterval(checkEndedMeetings, 15000); // Check every 15 seconds
}

module.exports = { startMeetingWatcher, checkEndedMeetings };

