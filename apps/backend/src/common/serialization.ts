// Money is BigInt (tiyin) end-to-end; JSON.stringify has no BigInt support,
// so responses serialize it as a decimal string.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

export {};
