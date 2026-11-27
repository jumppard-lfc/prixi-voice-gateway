const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { buildLenerovaOfficeHoursAnswer } = require('../../src/services/lenerova-office-hours.service');

const config = {
  clinicId: '172',
  voiceBotEnabled: true,
  timezone: 'Europe/Bratislava',
  workingHours: {
    monday: { enabled: true, from: '07:00', to: '12:00' },
    tuesday: { enabled: true, from: '07:00', to: '12:00' },
    wednesday: { enabled: true, from: '07:00', to: '12:00' },
    thursday: { enabled: true, from: '07:00', to: '12:00' },
    friday: { enabled: true, from: '07:00', to: '12:00' },
    saturday: { enabled: false, from: null, to: null },
    sunday: { enabled: false, from: null, to: null },
  },
};

test('Lenerovej všeobecná otázka prečíta aktuálny týždenný rozpis z EDS', () => {
  const answer = buildLenerovaOfficeHoursAnswer(config, 'Kedy ordinujete?');

  assert.match(answer, /od pondelka do piatka od siedmej do dvanástej/i);
  assert.match(answer, /V sobotu a v nedeľu neordinujeme/i);
});

test('Lenerovej otázka na konkrétny deň povie iba daný deň', () => {
  const answer = buildLenerovaOfficeHoursAnswer(config, 'Kedy ordinujete vo štvrtok?');

  assert.equal(answer, 'Vo štvrtok ordinujeme od siedmej do dvanástej.');
});

test('Lenerovej otázka na zajtra používa časové pásmo ambulancie', () => {
  const now = DateTime.fromISO('2026-11-27T10:00:00', { zone: 'Europe/Bratislava' });
  const answer = buildLenerovaOfficeHoursAnswer(config, 'Kedy ordinujete zajtra?', now);

  assert.equal(answer, 'V sobotu neordinujeme.');
});
