const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLenerovaSpeech,
  parseLenerovaRequestType,
} = require('../../src/services/lenerova-nlu.service');

test('Lenerovej menu rozpozná všetkých sedem volieb cez DTMF', () => {
  assert.equal(parseLenerovaRequestType('1'), 'prescription');
  assert.equal(parseLenerovaRequestType('2'), 'appointment');
  assert.equal(parseLenerovaRequestType('3'), 'appointment_change');
  assert.equal(parseLenerovaRequestType('4'), 'worsening');
  assert.equal(parseLenerovaRequestType('5'), 'administration');
  assert.equal(parseLenerovaRequestType('6'), 'new_patient');
  assert.equal(parseLenerovaRequestType('7'), 'information');
});

test('Lenerovej menu rozlíši prirodzené psychiatrické a administratívne požiadavky', () => {
  assert.equal(parseLenerovaRequestType('Potrebujem opakovaný recept'), 'prescription');
  assert.equal(parseLenerovaRequestType('Chcem termín kontroly'), 'appointment');
  assert.equal(parseLenerovaRequestType('Potrebujem zrušiť termín kontroly'), 'appointment_change');
  assert.equal(parseLenerovaRequestType('Mám vedľajšie účinky lieku'), 'worsening');
  assert.equal(parseLenerovaRequestType('Potrebujem lekársku správu'), 'administration');
  assert.equal(parseLenerovaRequestType('Chcem sa prihlásiť ako nový pacient'), 'new_patient');
  assert.equal(parseLenerovaRequestType('Aké máte ordinačné hodiny v Malackách?'), 'information');
});

test('Lenerovej normalizácia odstráni diakritiku a interpunkciu', () => {
  assert.equal(normalizeLenerovaSpeech('  Zrušiť termín, prosím! '), 'zrusit termin prosim');
});
