const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNimalaAppointmentType,
  parseNimalaDepartment,
  parseNimalaMainMenu,
  parseNimalaName,
  parseNimalaChoice,
  parseNimalaSlotChoice,
  parseNimalaYesNo,
  isNimalaRepeatSlotsRequest,
} = require('../../src/services/nimala-nlu.service');

test('Nimala demo najprv rozlíši urológiu od zatiaľ nepodporovaných ambulancií', () => {
  assert.equal(parseNimalaDepartment('urológia'), 'urology');
  assert.equal(parseNimalaDepartment('1'), 'urology');
  assert.equal(parseNimalaDepartment('estetika'), 'aesthetics');
  assert.equal(parseNimalaDepartment('sonografia'), 'ultrasound');
  assert.equal(parseNimalaDepartment('proktológia'), 'proctology');
  assert.equal(parseNimalaDepartment('potrebujem dermatológiu'), 'dermatology');
  assert.equal(parseNimalaDepartment('5'), 'dermatology');
});

test('Nimala menu rozpozná rezerváciu, presun, zrušenie aj ostatné požiadavky', () => {
  assert.equal(parseNimalaMainMenu('chcem sa objednať'), 'appointment');
  assert.equal(parseNimalaMainMenu('potrebujem zmeniť termín rezervácie'), 'reschedule');
  assert.equal(parseNimalaMainMenu('chcem prebookovať termín'), 'reschedule');
  assert.equal(parseNimalaMainMenu('prosím zrušiť moju rezerváciu'), 'cancel');
  assert.equal(parseNimalaMainMenu('stornovať termín'), 'cancel');
  assert.equal(parseNimalaMainMenu('potrebujem predpísať liek'), 'prescription');
  assert.equal(parseNimalaMainMenu('volám kvôli výsledkom'), 'results');
  assert.equal(parseNimalaMainMenu('chcem informácie o výsledkoch vyšetrenia'), 'results');
  assert.equal(parseNimalaMainMenu('spojte ma s človekom'), 'human');
});

test('Nimala rozpozná výber existujúcej rezervácie', () => {
  assert.equal(parseNimalaChoice('prvá rezervácia', 3), 0);
  assert.equal(parseNimalaChoice('možnosť dva', 3), 1);
  assert.equal(parseNimalaChoice('tri', 3), 2);
  assert.equal(parseNimalaChoice('tri', 2), undefined);
});

test('Nimala rozlíši všetkých šesť typov vyšetrení', () => {
  assert.equal(parseNimalaAppointmentType('VIP urológia'), 'vip_urology');
  assert.equal(parseNimalaAppointmentType('preventívna prehliadka'), 'preventive_exam');
  assert.equal(parseNimalaAppointmentType('konzultácia'), 'consultation');
  assert.equal(parseNimalaAppointmentType('kontrola po operácii'), 'postoperative_control');
  assert.equal(parseNimalaAppointmentType('konzultácia k prostate vodnou parou'), 'steam_prostate_consultation');
  assert.equal(parseNimalaAppointmentType('uroflowmetria'), 'ufm');
});

test('rezervácia vyžaduje meno aj priezvisko a jednoznačné potvrdenie', () => {
  assert.deepEqual(parseNimalaName('Ján Novák'), { firstName: 'Ján', lastName: 'Novák', fullName: 'Ján Novák' });
  assert.equal(parseNimalaName('Ján'), undefined);
  assert.equal(parseNimalaYesNo('áno, potvrdzujem'), true);
  assert.equal(parseNimalaYesNo('nie, iný termín'), false);
});

test('krátke hlasové odpovede áno a dva sa rozpoznajú v správnom kontexte', () => {
  const slots = [
    { startAt: '2026-11-16T09:00:00+01:00', calendarId: 7 },
    { startAt: '2026-11-17T10:30:00+01:00', calendarId: 7 },
    { startAt: '2026-11-18T13:00:00+01:00', calendarId: 7 },
  ];
  assert.equal(parseNimalaSlotChoice('dva', slots), 1);
  assert.equal(parseNimalaSlotChoice('možnosť dva', slots), 1);
  assert.equal(parseNimalaSlotChoice('druhý termín', slots), 1);
  assert.equal(parseNimalaYesNo('áno'), true);
  assert.equal(parseNimalaYesNo('annon'), true);
  assert.equal(parseNimalaYesNo('áno, platí'), true);
});

test('žiadosť o zopakovanie voľných termínov sa rozpozná bez zámeny za výber', () => {
  assert.equal(isNimalaRepeatSlotsRequest('zopakujte mi, prosím, voľné termíny'), true);
  assert.equal(isNimalaRepeatSlotsRequest('zopakujte, prosím'), true);
  assert.equal(isNimalaRepeatSlotsRequest('môžete tie možnosti povedať ešte raz?'), true);
  assert.equal(isNimalaRepeatSlotsRequest('znova ponuku termínov'), true);
  assert.equal(isNimalaRepeatSlotsRequest('chcem iný termín'), false);
});

