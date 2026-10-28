'use strict';

module.exports = function calculateTotalCents(lines) {
  return lines.reduce((total, line) => total + line.unitPriceCents, 0);
};
