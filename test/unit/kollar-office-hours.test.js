const test = require('node:test');
const assert = require('node:assert/strict');
const { buildKollarOfficeHoursMessage } = require('../../src/services/kollar-office-hours.service');

const workingHours = {
  monday: { enabled: true, from: '09:00', to: '17:00' },
  tuesday: { enabled: true, from: '07:00', to: '16:00' },
  wednesday: { enabled: true, from: '07:00', to: '13:00' },
  thursday: { enabled: true, from: '10:00', to: '17:00' },
  friday: { enabled: false, from: null, to: null },
  saturday: { enabled: false, from: null, to: null },
  sunday: { enabled: false, from: null, to: null },
};

test('vytvorí prirodzenú hlášku z nastavenia ambulancie', () => {
  const message = buildKollarOfficeHoursMessage({
    clinicId: '155',
    assistantType: 'kollar',
    enabled: true,
    voiceBotEnabled: true,
    workingHours,
    officeHoursNote: 'Utorok je prednostne tehotenská poradňa',
  });

  assert.match(message, /V pondelok ordinujeme od deviatej do sedemnástej/);
  assert.match(message, /V piatok neordinujeme/);
  assert.match(message, /V nedeľu neordinujeme/);
  assert.match(message, /Utorok je prednostne tehotenská poradňa\./);
  assert.match(message, /Dovidenia\.$/);
});

test('podporuje minúty v ordinačných hodinách', () => {
  const message = buildKollarOfficeHoursMessage({
    clinicId: '155',
    assistantType: 'kollar',
    enabled: true,
    workingHours: {
      ...workingHours,
      monday: { enabled: true, from: '07:30', to: '15:45' },
    },
  });

  assert.match(message, /od siedmej hodiny a 30 minút do pätnástej hodiny a 45 minút/);
});

test('odmietne cudziu, vypnutú alebo neúplnú konfiguráciu', () => {
  assert.equal(buildKollarOfficeHoursMessage({ clinicId: '42', assistantType: 'kollar', enabled: true, workingHours }), undefined);
  assert.equal(buildKollarOfficeHoursMessage({ clinicId: '155', assistantType: 'neurocentrum', enabled: true, workingHours }), undefined);
  assert.equal(buildKollarOfficeHoursMessage({ clinicId: '155', assistantType: 'kollar', enabled: false, workingHours }), undefined);
  assert.equal(buildKollarOfficeHoursMessage({ clinicId: '155', assistantType: 'kollar', enabled: true }), undefined);
});
