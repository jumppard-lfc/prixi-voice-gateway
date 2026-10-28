const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMalakovaSpeech,
  parseMalakovaAppointmentType,
  parseMalakovaMainMenu,
} = require('../../src/services/malakova-nlu.service');

test('Malakova hlavne menu podporuje hlas aj DTMF', () => {
  assert.equal(parseMalakovaMainMenu('chcem sa objednať'), 'appointment');
  assert.equal(parseMalakovaMainMenu('2'), 'prescription');
  assert.equal(parseMalakovaMainMenu('chcem sa spojiť s ambulanciou'), 'contact');
  assert.equal(parseMalakovaMainMenu('neviem'), undefined);
});

test('Malakova rozpozná všetky typy návštev', () => {
  assert.equal(parseMalakovaAppointmentType('zdravotné ťažkosti'), 'health_problem');
  assert.equal(parseMalakovaAppointmentType('potrebujem potvrdenie'), 'certificate');
  assert.equal(parseMalakovaAppointmentType('predoperačné vyšetrenie'), 'preoperative_exam');
  assert.equal(parseMalakovaAppointmentType('preventívna prehliadka'), 'preventive_exam');
  assert.equal(parseMalakovaAppointmentType('5'), 'other');
});

test('Malakova normalizácia odstráni diakritiku a interpunkciu', () => {
  assert.equal(normalizeMalakovaSpeech('  Žiadosť o RECEPT, prosím. '), 'ziadost o recept prosim');
});
