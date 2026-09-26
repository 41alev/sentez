const assert = require('assert/strict');
const { toMinor, fromMinor, multiplyMinor } = require('../server/lib/money');

assert.equal(toMinor('1.005'), 101, 'half cent rounds away from zero');
assert.equal(toMinor('2.675'), 268, 'decimal conversion must not inherit IEEE-754 2.675 bug');
assert.equal(toMinor(0.1 + 0.2), 30, 'binary floating artifact normalizes at money boundary');
assert.equal(toMinor('999999999999.99'), 99999999999999, 'large supported invoice remains exact');
assert.equal(fromMinor(101), 1.01);
assert.equal(multiplyMinor(10001, '1.2345'), 12346, 'FX conversion rounds once to base minor unit');
assert.equal(multiplyMinor(1, '0.5'), 1, 'half minor unit rounds away from zero');
assert.throws(() => toMinor('not-money'), /Invalid decimal/);
assert.throws(() => fromMinor(1.5), /safe integer/);
assert.throws(() => multiplyMinor(9_000_000_000_000_000, 2), /safe integer range/);
console.log('✓ exact money: decimal boundary, FX and safe-integer guards');
