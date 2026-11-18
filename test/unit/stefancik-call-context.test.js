const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  buildStefancikOfficeHoursMessage,
  isStefancikOfficeOpen,
  isStefancikRequestWindowOpen,
} = require('../../src/services/stefancik-call-context.service');
const { parseStefancikRequestType } = require('../../src/services/stefancik-nlu.service');

const config = {
  clinicId: '200',
  assistantType: 'stefancik',
  enabled: true,
  voiceBotEnabled: true,
  timezone: 'Europe/Bratislava',
  availability: { status: 'open' },
  workingHours: {
    monday: { enabled: true, from: '08:00', to: '12:00' },
    tuesday: { enabled: true, from: '13:00', to: '16:00' },
    wednesday: { enabled: true, from: '07:30', to: '12:00' },
    thursday: { enabled: true, from: '07:30', to: '12:00' },
    friday: { enabled: true, from: '07:30', to: '11:30' },
    saturday: { enabled: false, from: null, to: null },
    sunday: { enabled: false, from: null, to: null },
  },
};

test('rozozná štyri dohodnuté kategórie hlasom aj klávesnicou', () => {
  assert.equal(parseStefancikRequestType('chcem sa objednať na termín'), 'appointment');
  assert.equal(parseStefancikRequestType('volám ohľadom výsledkov krvi'), 'results');
  assert.equal(parseStefancikRequestType('potrebujem predpísať lieky'), 'prescription');
  assert.equal(parseStefancikRequestType('aké máte ordinačné hodiny'), 'office_hours');
  assert.equal(parseStefancikRequestType('4'), 'office_hours');
});

test('odlišuje konfigurované ordinačné hodiny od ranného okna PriXi', () => {
  const mondayMorning = DateTime.fromISO('2026-11-23T08:30:00+01:00');
  const tuesdayMorning = DateTime.fromISO('2026-11-24T08:30:00+01:00');
  const tuesdayAfternoon = DateTime.fromISO('2026-11-24T14:00:00+01:00');
  assert.equal(isStefancikOfficeOpen(config, mondayMorning), true);
  assert.equal(isStefancikOfficeOpen(config, tuesdayMorning), false);
  assert.equal(isStefancikOfficeOpen(config, tuesdayAfternoon), true);
  assert.equal(isStefancikRequestWindowOpen(config, tuesdayMorning), true);
  assert.equal(isStefancikRequestWindowOpen(config, tuesdayAfternoon), false);
});

test('číta ordinačné hodiny z PriXi a pri chýbajúcej konfigurácii použije fotografiu', () => {
  const configured = buildStefancikOfficeHoursMessage({ ...config, officeHoursNote: 'V utorok ordinujeme popoludní' });
  assert.match(configured, /V pondelok ordinujeme od ôsmej do dvanástej/);
  assert.match(configured, /V piatok ordinujeme od siedmej tridsať do jedenástej tridsať/);
  assert.match(configured, /V utorok ordinujeme popoludní\./);

  const fallback = buildStefancikOfficeHoursMessage();
  assert.match(fallback, /V pondelok ordinujeme od siedmej tridsať do dvanástej/);
  assert.match(fallback, /V utorok ordinujeme od trinástej do šestnástej/);
  assert.match(fallback, /V sobotu neordinujeme/);
});
