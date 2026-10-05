function formatBookingCode(id) {
  return `CONF-${String(id).padStart(6, '0')}`;
}

module.exports = { formatBookingCode };
