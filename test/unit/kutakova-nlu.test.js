const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeKutakovaDateOfBirth,
  parseKutakovaHealthInsurer,
  parseKutakovaLanguage,
  parseKutakovaYesNo,
} = require('../../src/services/kutakova-nlu.service');

test('Kutakova bot rozpozna slovenske poistovne hlasom aj DTMF', () => {
  assert.equal(parseKutakovaHealthInsurer('Všeobecná zdravotná poisťovňa'), 'Všeobecná zdravotná poisťovňa');
  assert.equal(parseKutakovaHealthInsurer('VšZP'), 'Všeobecná zdravotná poisťovňa');
  assert.equal(parseKutakovaHealthInsurer('2'), 'Dôvera');
  assert.equal(parseKutakovaHealthInsurer('Union'), 'Union');
  assert.equal(parseKutakovaHealthInsurer('neviem'), 'Iná alebo neuvedená');
  assert.equal(parseKutakovaHealthInsurer('možno'), undefined);
});

test('Kutakova bot rozpozna volbu slovenciny a anglictiny', () => {
  assert.equal(parseKutakovaLanguage('slovensky'), 'sk');
  assert.equal(parseKutakovaLanguage('1'), 'sk');
  assert.equal(parseKutakovaLanguage('English'), 'en');
  assert.equal(parseKutakovaLanguage('2'), 'en');
});

test('Kutakova bot rozpozna ano a nie v oboch jazykoch', () => {
  assert.equal(parseKutakovaYesNo('áno'), true);
  assert.equal(parseKutakovaYesNo('nie'), false);
  assert.equal(parseKutakovaYesNo('yes'), true);
  assert.equal(parseKutakovaYesNo('no'), false);
});

test('Kutakova bot normalizuje anglicky datum narodenia', () => {
  assert.equal(normalizeKutakovaDateOfBirth('April 12th 1985', 'en'), '12.04.1985');
  assert.equal(normalizeKutakovaDateOfBirth('12 April 1985', 'en'), '12.04.1985');
  assert.equal(normalizeKutakovaDateOfBirth('February 31st 1985', 'en'), undefined);
});
