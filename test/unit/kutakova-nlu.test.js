const test = require('node:test');
const assert = require('node:assert/strict');

const { parseKutakovaHealthInsurer } = require('../../src/services/kutakova-nlu.service');

test('Kutakova bot rozpozna slovenske poistovne hlasom aj DTMF', () => {
  assert.equal(parseKutakovaHealthInsurer('Všeobecná zdravotná poisťovňa'), 'Všeobecná zdravotná poisťovňa');
  assert.equal(parseKutakovaHealthInsurer('VšZP'), 'Všeobecná zdravotná poisťovňa');
  assert.equal(parseKutakovaHealthInsurer('2'), 'Dôvera');
  assert.equal(parseKutakovaHealthInsurer('Union'), 'Union');
  assert.equal(parseKutakovaHealthInsurer('neviem'), 'Iná alebo neuvedená');
  assert.equal(parseKutakovaHealthInsurer('možno'), undefined);
});
