const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLenerovaConversationContinue,
  isLenerovaConversationFinish,
  isLenerovaInformationMenuChoice,
  isLenerovaOfficeHoursQuestion,
  normalizeLenerovaSpeech,
  parseLenerovaInformationTopic,
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
  assert.equal(parseLenerovaRequestType('Chcel by som si objednať lieky'), 'prescription');
  assert.equal(parseLenerovaRequestType('Potrebujem objednať tablety'), 'prescription');
  assert.equal(parseLenerovaRequestType('Chcem termín kontroly'), 'appointment');
  assert.equal(parseLenerovaRequestType('Chcem sa objednať na kontrolu kvôli liekom'), 'appointment');
  assert.equal(parseLenerovaRequestType('Potrebujem zrušiť termín kontroly'), 'appointment_change');
  assert.equal(parseLenerovaRequestType('Mám vedľajšie účinky lieku'), 'worsening');
  assert.equal(parseLenerovaRequestType('Potrebujem lekársku správu'), 'administration');
  assert.equal(parseLenerovaRequestType('Chcem sa prihlásiť ako nový pacient'), 'new_patient');
  assert.equal(parseLenerovaRequestType('Aké máte ordinačné hodiny v Malackách?'), 'information');
  assert.equal(parseLenerovaRequestType('Kde máte ambulanciu?'), 'information');
  assert.equal(parseLenerovaRequestType('Máte zmluvu s Dôverou?'), 'information');
});

test('Lenerovej normalizácia odstráni diakritiku a interpunkciu', () => {
  assert.equal(normalizeLenerovaSpeech('  Zrušiť termín, prosím! '), 'zrusit termin prosim');
});

test('Lenerovej informačný flow rozpozná hodiny aj pokračovanie rozhovoru', () => {
  assert.equal(isLenerovaOfficeHoursQuestion('Kedy ordinujete?'), true);
  assert.equal(isLenerovaOfficeHoursQuestion('Dokedy máte dnes otvorené?'), true);
  assert.equal(isLenerovaConversationContinue('Áno, prosím'), true);
  assert.equal(isLenerovaConversationContinue('1'), true);
  assert.equal(isLenerovaConversationFinish('Nie, ďakujem, to je všetko'), true);
  assert.equal(isLenerovaConversationFinish('2'), true);
});

test('Lenerovej organizačné otázky rozdelí bez vytvorenia pacientskej požiadavky', () => {
  assert.equal(parseLenerovaInformationTopic('Kde máte ambulanciu?'), 'location');
  assert.equal(parseLenerovaInformationTopic('Máte zmluvu s Dôverou?'), 'insurance');
  assert.equal(parseLenerovaInformationTopic('Kto zastupuje počas dovolenky?'), 'substitution');
  assert.equal(parseLenerovaInformationTopic('Aký máte e-mail?'), 'contact');
  assert.equal(isLenerovaInformationMenuChoice('7'), true);
  assert.equal(isLenerovaInformationMenuChoice('organizačné informácie'), true);
  assert.equal(isLenerovaInformationMenuChoice('Kto vás zastupuje?'), false);
});
