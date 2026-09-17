const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');

process.env.NODE_ENV = 'test';

const { isVadkertiWithinBusinessHours } = require('../../src/routes/vadkerti-voice-bot.controller');

function at(iso) {
  return DateTime.fromISO(iso, { zone: 'Europe/Bratislava' });
}

test('Vadkerti bot prijima poziadavky v pracovny den od 07:30 do 12:00', () => {
  assert.equal(isVadkertiWithinBusinessHours(at('2026-09-16T07:29:59')), false);
  assert.equal(isVadkertiWithinBusinessHours(at('2026-09-16T07:30:00')), true);
  assert.equal(isVadkertiWithinBusinessHours(at('2026-09-16T11:59:59')), true);
  assert.equal(isVadkertiWithinBusinessHours(at('2026-09-16T12:00:00')), false);
  assert.equal(isVadkertiWithinBusinessHours(at('2026-09-19T09:00:00')), false);
});
