const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  CELKOVA_CONTEXT_MESSAGES,
  getCelkovaTimeMessage,
} = require('../../src/services/pediatric-call-context.service');

const at = (iso) => DateTime.fromISO(iso, { zone: 'Europe/Bratislava' });

test('v pracovny den od 7:00 do 7:30 oznami dostupnost aj osetrenie do 12:00', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-31T07:15:00')),
    CELKOVA_CONTEXT_MESSAGES.beforePhoneHours
  );
});

test('v pracovny den od 7:30 do 12:00 vzdy oznami osetrenie do 12:00', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-31T10:00:00')),
    CELKOVA_CONTEXT_MESSAGES.acuteBeforeNoon
  );
});

test('v pracovny den od 12:00 do 15:00 vzdy oznami poobedny rezim', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-31T13:00:00')),
    CELKOVA_CONTEXT_MESSAGES.afternoonSchedule
  );
});

test('v pracovny den od 15:00 do 16:00 oznami telefonicku dostupnost', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-31T15:30:00')),
    CELKOVA_CONTEXT_MESSAGES.phoneHours
  );
});

test('v pracovny den od 16:00 do 20:00 oznami detsku pohotovost v Ziline', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-31T18:00:00')),
    CELKOVA_CONTEXT_MESSAGES.childEmergency
  );
});

test('od 20:00 do 7:00 vzdy oznami nemocnicneho lekara', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-31T22:00:00')),
    CELKOVA_CONTEXT_MESSAGES.hospitalEmergency
  );
});

test('cez vikend od 7:00 do 20:00 oznami telefonicku dostupnost v pracovnych dnoch', () => {
  assert.equal(
    getCelkovaTimeMessage(at('2026-08-30T11:00:00')),
    CELKOVA_CONTEXT_MESSAGES.phoneHours
  );
});
