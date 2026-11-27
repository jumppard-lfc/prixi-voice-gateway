const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLenerovaInformationAnswer } = require('../../src/services/lenerova-information.service');

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

test('overené ordinačné hodiny zodpovie priamo', () => {
  assert.match(
    buildLenerovaInformationAnswer(config, 'Kedy ordinujete?'),
    /od pondelka do piatka od siedmej do dvanástej/i
  );
});

test('pri nepotvrdenom organizačnom údaji nevymýšľa odpoveď', () => {
  assert.match(
    buildLenerovaInformationAnswer(config, 'Kto zastupuje počas dovolenky?'),
    /nemám spoľahlivo potvrdenú/i
  );
});
