const db = require('../config/db');

/**
 * Parses participant names/emails (separated by commas, semicolons, or newlines)
 * and resolves each attendee to their official registered company email address.
 * 
 * Resolution order for each attendee:
 * 1. If an email address is embedded (e.g. "priya.sharma@algorisys.com", "Priya Sharma (priya@algorisys.com)", "Priya <priya@algorisys.com>"):
 *    - Extract email using regex
 *    - Query database to find registered user record
 * 2. If no email is present (e.g. "Priya Sharma", "Rahul Verma"):
 *    - Search active registered users by exact full_name (case-insensitive)
 *    - Search active registered users by email username prefix (e.g. "priya.sharma@algorisys.com")
 *    - Search active registered users by partial name/substring match
 * 3. Fallback for unregistered colleagues:
 *    - Synthesize standard company email (e.g. first.last@algorisys.com)
 * 
 * Excludes the person who booked the hall (bookerEmail) to avoid sending duplicate emails,
 * and deduplicates so each attendee only receives one invitation.
 * 
 * @param {string} participantsString - e.g. "Priya Sharma, rahul.verma@algorisys.com, Sumit (sumit@algorisys.com)"
 * @param {string} bookerEmail - Email of the organizer booking the hall (excluded)
 * @returns {Array<{ name: string, email: string }>}
 */
function resolveAttendeeEmails(participantsString, bookerEmail = '') {
  if (!participantsString || typeof participantsString !== 'string') return [];

  // Split on commas, semicolons, or newlines
  const rawEntries = participantsString
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const resolved = [];
  const seenEmails = new Set();
  const bookerEmailNorm = (bookerEmail || '').trim().toLowerCase();
  if (bookerEmailNorm) {
    seenEmails.add(bookerEmailNorm);
  }

  for (const raw of rawEntries) {
    const entry = raw.trim();
    if (!entry) continue;

    // 1. Check if there is an email address embedded anywhere in entry
    // Handles formats like:
    // - "priya.sharma@algorisys.com"
    // - "Priya Sharma <priya.sharma@algorisys.com>"
    // - "Priya Sharma (priya.sharma@algorisys.com)"
    const emailMatch = entry.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

    if (emailMatch) {
      const emailLower = emailMatch[1].toLowerCase().trim();
      if (!seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);

        // Check if this email belongs to an active registered employee
        const userRow = db.prepare('SELECT full_name, email FROM users WHERE LOWER(email) = ?').get(emailLower);

        let displayName = userRow ? userRow.full_name : '';
        if (!displayName) {
          const cleanedName = entry.replace(emailMatch[0], '').replace(/[<>()"']/g, '').trim();
          displayName = cleanedName || emailLower.split('@')[0];
        }

        resolved.push({
          email: userRow ? userRow.email : emailLower,
          name: displayName,
        });
      }
      continue;
    }

    // 2. Entry has NO email address, only a name or username
    // E.g. "Priya Sharma", "Rahul", "priya.sharma"
    const cleanName = entry.replace(/[<>()"']/g, '').trim();
    if (!cleanName) continue;

    // Search active registered users in the database:
    // A) Exact full_name match (case-insensitive)
    let userMatch = db.prepare(`
      SELECT full_name, email FROM users
      WHERE active = 1 AND LOWER(TRIM(full_name)) = LOWER(TRIM(?))
      LIMIT 1
    `).get(cleanName);

    // B) If not found, match by email username prefix (e.g. "priya.sharma" or "priya sharma" -> "priya.sharma@...")
    if (!userMatch) {
      const formattedPrefix = cleanName.toLowerCase().replace(/\s+/g, '.');
      userMatch = db.prepare(`
        SELECT full_name, email FROM users
        WHERE active = 1 AND (
          LOWER(email) = LOWER(?) OR
          LOWER(email) LIKE LOWER(?)
        )
        LIMIT 1
      `).get(
        `${formattedPrefix}@algorisys.com`,
        `${formattedPrefix}@%`
      );
    }

    // C) If not found, partial match on full_name (e.g. first name or substring)
    if (!userMatch && cleanName.length >= 3) {
      userMatch = db.prepare(`
        SELECT full_name, email FROM users
        WHERE active = 1 AND (
          LOWER(full_name) LIKE LOWER(?) OR
          LOWER(?) LIKE ('%' || LOWER(full_name) || '%')
        )
        ORDER BY LENGTH(full_name) ASC
        LIMIT 1
      `).get(`%${cleanName}%`, cleanName);
    }

    if (userMatch && userMatch.email) {
      const emailLower = userMatch.email.toLowerCase().trim();
      if (!seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);
        resolved.push({
          email: userMatch.email,
          name: userMatch.full_name,
        });
      }
    } else {
      // D) Fallback: if colleague is not yet in the system, construct standard company email
      const nameParts = cleanName.split(/\s+/).filter(Boolean);
      const fallbackEmail = nameParts.length >= 2 
        ? `${nameParts.join('.').toLowerCase()}@algorisys.com`
        : `${cleanName.toLowerCase()}@algorisys.com`;

      if (!seenEmails.has(fallbackEmail)) {
        seenEmails.add(fallbackEmail);
        resolved.push({
          email: fallbackEmail,
          name: cleanName,
        });
      }
    }
  }

  return resolved;
}

module.exports = { resolveAttendeeEmails };
