const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKollarRequestType } = require('../../src/services/kollar-nlu.service');

test('Kollar menu podporuje DTMF volby jedna az sedem', () => {
  assert.equal(parseKollarRequestType('1'), 'acute_problem');
  assert.equal(parseKollarRequestType('2'), 'prescription');
  assert.equal(parseKollarRequestType('3'), 'results');
  assert.equal(parseKollarRequestType('4'), 'appointment');
  assert.equal(parseKollarRequestType('5'), 'new_patient');
  assert.equal(parseKollarRequestType('6'), 'office_hours');
  assert.equal(parseKollarRequestType('7'), 'human_message');
});

test('Kollar menu rozpozna prirodzene slovenske poziadavky', () => {
  assert.equal(parseKollarRequestType('Mám akútny problém'), 'acute_problem');
  assert.equal(parseKollarRequestType('potrebujem predpísať lieky'), 'prescription');
  assert.equal(parseKollarRequestType('volám kvôli výsledkom cytológie'), 'results');
  assert.equal(parseKollarRequestType('chcem sa objednať na prehliadku'), 'appointment');
  assert.equal(parseKollarRequestType('chcem byť nová pacientka'), 'new_patient');
  assert.equal(parseKollarRequestType('aké máte ordinačné hodiny'), 'office_hours');
  assert.equal(parseKollarRequestType('chcem sa rozprávať so sestrou'), 'human_message');
});
