const db = require('../config/db');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses comma-separated participant names/emails and resolves their email addresses
 * by querying registered users in the database and checking for explicit email inputs.
 * 
 * @param {string} participantsString - e.g. "Priya Sharma, sumit.tripathi@algorisys.com, Rahul Verma"
 * @param {string} bookerEmail - Email of the person booking (excluded from attendee invitations)
 * @returns {Array<{ name: string, email: string }>}
 */
function resolveAttendeeEmails(participantsString, bookerEmail = '') {
  if (!participantsString || typeof participantsString !== 'string') return [];

  const rawEntries = participantsString
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const resolved = [];
  const seenEmails = new Set();
  if (bookerEmail) {
    seenEmails.add(bookerEmail.trim().toLowerCase());
  }

  for (const raw of rawEntries) {
    const entry = raw.trim();
    if (!entry) continue;

    // 1. If entry is directly an email address (e.g., name@algorisys.com)
    if (EMAIL_REGEX.test(entry)) {
      const emailLower = entry.toLowerCase();
      if (!seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);
        const userRow = db.prepare('SELECT full_name FROM users WHERE LOWER(email) = ?').get(emailLower);
        resolved.push({
          email: emailLower,
          name: userRow ? userRow.full_name : entry.split('@')[0],
        });
      }
      continue;
    }

    // 2. Entry is a person's name: search active users in the database
    // Checks for exact match, case-insensitive match, or substring match
    const userMatch = db.prepare(`
      SELECT full_name, email FROM users
      WHERE active = 1 AND (
        LOWER(full_name) = LOWER(?) OR
        LOWER(full_name) LIKE LOWER(?) OR
        LOWER(email) = LOWER(?)
      )
      LIMIT 1
    `).get(
      entry,
      `%${entry}%`,
      `${entry.toLowerCase().replace(/\s+/g, '.')}@algorisys.com`
    );

    if (userMatch && userMatch.email) {
      const emailLower = userMatch.email.toLowerCase();
      if (!seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);
        resolved.push({
          email: emailLower,
          name: userMatch.full_name,
        });
      }
    } else {
      // 3. Fallback: if not in database yet, create company email format (e.g. John Doe -> john.doe@algorisys.com)
      const nameParts = entry.split(/\s+/).filter(Boolean);
      if (nameParts.length >= 2) {
        const fallbackEmail = `${nameParts.join('.').toLowerCase()}@algorisys.com`;
        if (!seenEmails.has(fallbackEmail)) {
          seenEmails.add(fallbackEmail);
          resolved.push({
            email: fallbackEmail,
            name: entry,
          });
        }
      }
    }
  }

  return resolved;
}

module.exports = { resolveAttendeeEmails };
