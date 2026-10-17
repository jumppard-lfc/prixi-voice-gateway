const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractKollarBirthYear,
  parseKollarIdentity,
  parseKollarRequestType,
} = require('../../src/services/kollar-nlu.service');

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
  assert.equal(parseKollarRequestType('chcela by som sa sa stať vašou pacientkou'), 'new_patient');
  assert.equal(parseKollarRequestType('chcem k vám prestúpiť'), 'new_patient');
  assert.equal(parseKollarRequestType('aké máte ordinačné hodiny'), 'office_hours');
  assert.equal(parseKollarRequestType('chcem sa rozprávať so sestrou'), 'human_message');
});

test('Kollar bot extrahuje iba platny rok narodenia', () => {
  assert.equal(extractKollarBirthYear('narodila som sa v roku 1987'), '1987');
  assert.equal(extractKollarBirthYear('1987.'), '1987');
  assert.equal(extractKollarBirthYear('neviem'), undefined);
  assert.equal(extractKollarBirthYear('2099'), undefined);
});

test('Kollar bot rozdeli meno a rok narodenia z jednej odpovede', () => {
  assert.deepEqual(parseKollarIdentity('Jana Nováková, 1987'), {
    patientName: 'Jana Nováková',
    birthYear: '1987',
  });
  assert.deepEqual(parseKollarIdentity('Volám sa Anna Horváthová, rok narodenia 1991'), {
    patientName: 'Anna Horváthová',
    birthYear: '1991',
  });
  assert.deepEqual(parseKollarIdentity('Anna Horváthová'), {
    patientName: 'Anna Horváthová',
    birthYear: undefined,
  });
});
