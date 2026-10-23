'use strict';

const DEFAULT_DISCOUNT_CENTS = 100;

module.exports = function priceAfterDiscount(priceCents, discountCents) {
  const selectedDiscount = discountCents || DEFAULT_DISCOUNT_CENTS;
  return priceCents - selectedDiscount;
};
