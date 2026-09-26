// @ts-nocheck
/**
 * Posted monetary totals are stored as integer minor units (kuruş/cents).
 * Rates and quantities may have more precision, but every ledger amount crosses
 * this boundary exactly once using half-away-from-zero rounding.
 */
function decimalParts(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError('Money value must be a number or decimal string');
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new TypeError(`Invalid decimal money value: ${text}`);
  const negative = match[1] === '-';
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  return { negative, digits: BigInt((match[2] + fraction).replace(/^0+(?=\d)/, '')), scale: fraction.length - exponent };
}

function roundedInteger({ negative, digits, scale }, targetScale) {
  const shift = targetScale - scale;
  let result;
  if (shift >= 0) {
    result = digits * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    result = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }
  return negative ? -result : result;
}

function safeNumber(integer, label) {
  const number = Number(integer);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${label} exceeds safe integer range`);
  return number;
}

function toMinor(value) {
  return safeNumber(roundedInteger(decimalParts(value), 2), 'Money amount');
}

function fromMinor(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('Minor amount must be a safe integer');
  return value / 100;
}

/** Convert an amount in minor units through a decimal FX/rate, returning minor units. */
function multiplyMinor(minor, rate) {
  if (!Number.isSafeInteger(minor)) throw new TypeError('Minor amount must be a safe integer');
  const parsed = decimalParts(rate);
  const signed = BigInt(minor) * (parsed.negative ? -parsed.digits : parsed.digits);
  const negative = signed < 0n;
  const digits = negative ? -signed : signed;
  return safeNumber(roundedInteger({ negative, digits, scale: parsed.scale }, 0), 'Converted money amount');
}

module.exports = { toMinor, fromMinor, multiplyMinor };
