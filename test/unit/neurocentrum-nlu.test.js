const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isNeurocentrumUrgent,
  normalizeNeurocentrumDateOfBirth,
  parseNeurocentrumRequestType,
  parseNeurocentrumYesNo,
} = require('../../src/services/neurocentrum-nlu.service');

test('Neurocentrum rozpozná odpovede áno a nie vrátane DTMF', () => {
  assert.equal(parseNeurocentrumYesNo('Áno, som pacientka'), true);
  assert.equal(parseNeurocentrumYesNo('1'), true);
  assert.equal(parseNeurocentrumYesNo('Nie som'), false);
  assert.equal(parseNeurocentrumYesNo('2'), false);
  assert.equal(parseNeurocentrumYesNo('možno'), undefined);
});

test('Neurocentrum rozlíši tri podporované požiadavky', () => {
  assert.equal(parseNeurocentrumRequestType('Potrebujem predpísať lieky'), 'prescription');
  assert.equal(parseNeurocentrumRequestType('Chcem termín na kontrolu'), 'follow_up');
  assert.equal(parseNeurocentrumRequestType('Volám ohľadom výsledku MRI'), 'results');
  assert.equal(parseNeurocentrumRequestType('Volám ohľadom výsledkov vyšetrenia'), 'results');
  assert.equal(parseNeurocentrumRequestType('3'), 'results');
});

test('dátum narodenia sa normalizuje do Curo formátu', () => {
  assert.equal(normalizeNeurocentrumDateOfBirth('15. 3. 1980'), '15.03.1980');
  assert.equal(normalizeNeurocentrumDateOfBirth('15 marca 1980'), '15.03.1980');
  assert.equal(normalizeNeurocentrumDateOfBirth('31 februára 1980'), undefined);
});

test('urgentný neurologický príznak preruší administratívny flow', () => {
  assert.equal(isNeurocentrumUrgent('Náhle mi ochrnula pravá strana a neviem rozprávať'), true);
  assert.equal(isNeurocentrumUrgent('Potrebujem recept'), false);
});
