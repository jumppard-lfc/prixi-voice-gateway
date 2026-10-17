const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isNeurocentrumPrescriptionDetailComplete,
  isNeurocentrumUrgent,
  normalizeNeurocentrumDateOfBirth,
  parseNeurocentrumFollowUpType,
  parseNeurocentrumRequestType,
  parseNeurocentrumYesNo,
} = require('../../src/services/neurocentrum-nlu.service');

test('Neurocentrum pri recepte rozpozná názov lieku spolu s počtom balení', () => {
  assert.equal(isNeurocentrumPrescriptionDetailComplete('Tegretol 200 miligramov, dve balenia'), true);
  assert.equal(isNeurocentrumPrescriptionDetailComplete('Madopar 125, 2 balenia a Neurol, jedno balenie'), true);
  assert.equal(isNeurocentrumPrescriptionDetailComplete('Potrebujem predpísať lieky'), false);
  assert.equal(isNeurocentrumPrescriptionDetailComplete('Dve balenia liekov'), false);
  assert.equal(isNeurocentrumPrescriptionDetailComplete('Neviem názov'), false);
});

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
  assert.equal(parseNeurocentrumRequestType('Chcem sa objednať na EMG'), 'follow_up');
  assert.equal(parseNeurocentrumRequestType('EMG'), 'follow_up');
  assert.equal(parseNeurocentrumRequestType('Potrebujem obstrek'), 'follow_up');
  assert.equal(parseNeurocentrumRequestType('Chcem výsledky EMG'), 'results');
  assert.equal(parseNeurocentrumRequestType('3'), 'results');
});

test('Neurocentrum rozlíši tri typy kontroly vrátane DTMF', () => {
  assert.equal(parseNeurocentrumFollowUpType('klasická kontrola'), 'classic');
  assert.equal(parseNeurocentrumFollowUpType('1'), 'classic');
  assert.equal(parseNeurocentrumFollowUpType('EMG vyšetrenie'), 'emg');
  assert.equal(parseNeurocentrumFollowUpType('2'), 'emg');
  assert.equal(parseNeurocentrumFollowUpType('obstrek'), 'injection');
  assert.equal(parseNeurocentrumFollowUpType('3'), 'injection');
  assert.equal(parseNeurocentrumFollowUpType('kontrola'), undefined);
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
