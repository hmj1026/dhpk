'use strict';

const DEFAULT_DISCOUNT_CENTS = 100;

module.exports = function priceAfterDiscount(priceCents, discountCents) {
  const selectedDiscount = discountCents === undefined ? DEFAULT_DISCOUNT_CENTS : discountCents;
  return priceCents - selectedDiscount;
};
