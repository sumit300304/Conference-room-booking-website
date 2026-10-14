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
function findRegisteredUser(entry) {
  if (!entry || typeof entry !== 'string') return null;
  const raw = entry.trim();
  if (!raw) return null;

  // 1. If numeric ID was passed
  if (/^\d+$/.test(raw)) {
    const userById = db.prepare('SELECT id, full_name, email, department FROM users WHERE id = ? AND active = 1').get(Number(raw));
    if (userById) return userById;
  }

  // 2. Email embedded (e.g. "priya.sharma@algorisys.com" or "Priya (priya@algorisys.com)")
  const emailMatch = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) {
    const emailLower = emailMatch[1].toLowerCase().trim();
    const userByEmail = db.prepare('SELECT id, full_name, email, department FROM users WHERE active = 1 AND LOWER(email) = ?').get(emailLower);
    if (userByEmail) return userByEmail;
  }

  // 3. Clean string without brackets/quotes
  const cleanName = raw.replace(/[<>()"']/g, '').trim();
  if (!cleanName) return null;

  // Exact full_name match (case-insensitive)
  const userByName = db.prepare('SELECT id, full_name, email, department FROM users WHERE active = 1 AND LOWER(TRIM(full_name)) = LOWER(TRIM(?)) LIMIT 1').get(cleanName);
  if (userByName) return userByName;

  // Prefix match on email (e.g. "priya.sharma")
  const formattedPrefix = cleanName.toLowerCase().replace(/\s+/g, '.');
  const userByPrefix = db.prepare(`
    SELECT id, full_name, email, department FROM users
    WHERE active = 1 AND (
      LOWER(email) = LOWER(?) OR
      LOWER(email) LIKE LOWER(?)
    )
    LIMIT 1
  `).get(`${formattedPrefix}@algorisys.com`, `${formattedPrefix}@%`);
  if (userByPrefix) return userByPrefix;

  // Partial match on full_name if at least 3 characters
  if (cleanName.length >= 3) {
    const userBySub = db.prepare(`
      SELECT id, full_name, email, department FROM users
      WHERE active = 1 AND (
        LOWER(full_name) LIKE LOWER(?) OR
        LOWER(?) LIKE ('%' || LOWER(full_name) || '%')
      )
      ORDER BY LENGTH(full_name) ASC
      LIMIT 1
    `).get(`%${cleanName}%`, cleanName);
    if (userBySub) return userBySub;
  }

  return null;
}

/**
 * Validates that all participants in a comma/semicolon/newline-delimited string
 * exist as active registered employees in the database.
 * Rejects any random or unregistered names.
 * 
 * @param {string} participantsString
 * @returns {{ valid: boolean, error?: string, users?: Array<{ id: number, full_name: string, email: string, department: string }> }}
 */
function validateAttendees(participantsString) {
  if (!participantsString || typeof participantsString !== 'string' || !participantsString.trim()) {
    return { valid: false, error: 'Please select at least one employee from the registered employees dropdown.' };
  }

  const rawEntries = participantsString
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawEntries.length === 0) {
    return { valid: false, error: 'Please select at least one employee from the registered employees dropdown.' };
  }

  const validUsers = [];
  const seenUserIds = new Set();

  for (const raw of rawEntries) {
    const matched = findRegisteredUser(raw);
    if (!matched) {
      return {
        valid: false,
        error: `"${raw}" is not a registered employee in the database. Only active employees can be selected.`,
      };
    }
    if (!seenUserIds.has(matched.id)) {
      seenUserIds.add(matched.id);
      validUsers.push(matched);
    }
  }

  return { valid: true, users: validUsers };
}

/**
 * Resolves participant entries to active registered employee records with their verified emails.
 * Only returns verified employees from the database.
 * Excludes bookerEmail to avoid sending duplicate emails.
 * 
 * @param {string} participantsString - e.g. "Priya Sharma, rahul.verma@algorisys.com"
 * @param {string} bookerEmail - Email of the organizer booking the hall (excluded)
 * @returns {Array<{ id: number, name: string, email: string, department: string }>}
 */
function resolveAttendeeEmails(participantsString, bookerEmail = '') {
  if (!participantsString || typeof participantsString !== 'string') return [];

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
    const matched = findRegisteredUser(raw);
    if (!matched) continue; // Ignore any unregistered names

    const emailNorm = matched.email.toLowerCase().trim();
    if (!seenEmails.has(emailNorm)) {
      seenEmails.add(emailNorm);
      resolved.push({
        id: matched.id,
        name: matched.full_name,
        email: matched.email,
        department: matched.department || '',
      });
    }
  }

  return resolved;
}

module.exports = {
  findRegisteredUser,
  validateAttendees,
  resolveAttendeeEmails,
};
