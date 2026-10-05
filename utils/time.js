// All date/time logic for the app is anchored to Asia/Kolkata,
// regardless of the server's own timezone or the client's browser timezone.

const TIME_ZONE = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Returns the current India date/time as structured, string-comparable values.
 * date  -> "YYYY-MM-DD"
 * time  -> "HH:MM" (24-hour, zero-padded)
 */
function getIndiaNow() {
  const parts = dateFmt.formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  let hour = parts.hour === '24' ? '00' : parts.hour;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

// Basic HH:MM (24hr) validator
function isValidTimeString(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

module.exports = {
  TIME_ZONE,
  getIndiaNow,
  isValidTimeString,
  isValidDateString,
};
