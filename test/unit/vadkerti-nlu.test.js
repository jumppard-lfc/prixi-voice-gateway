const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractBirthYear,
  isSocialPurposeReport,
  isVadkertiUrgent,
  parseAppointmentAction,
  parseVadkertiIntent,
  parseVadkertiLanguage,
  parseVadkertiYesNo,
} = require('../../src/services/vadkerti-nlu.service');

test('Vadkerti jazyk a ano/nie funguju po slovensky aj po madarsky', () => {
  assert.equal(parseVadkertiLanguage('po slovensky'), 'sk');
  assert.equal(parseVadkertiLanguage('magyarul'), 'hu');
  assert.equal(parseVadkertiLanguage('2'), 'hu');
  assert.equal(parseVadkertiYesNo('áno, prosím'), true);
  assert.equal(parseVadkertiYesNo('igen'), true);
  assert.equal(parseVadkertiYesNo('nem'), false);
});

test('Vadkerti NLU rozlisuje vsetky hlavne typy poziadaviek', () => {
  assert.equal(parseVadkertiIntent('Ešte nikdy som nebol u neurológa'), 'new_patient_no_neurologist');
  assert.equal(parseVadkertiIntent('Chodil som k inému neurológovi'), 'new_to_clinic_seen_neurologist');
  assert.equal(parseVadkertiIntent('Bol som u vás a potrebujem kontrolu'), 'existing_patient_follow_up');
  assert.equal(parseVadkertiIntent('Mám výsledok MRI'), 'follow_up_with_results');
  assert.equal(parseVadkertiIntent('Potrebujem USG karotíd'), 'procedure_or_therapy');
  assert.equal(parseVadkertiIntent('Potrebujem predpísať lieky'), 'prescription');
  assert.equal(parseVadkertiIntent('Prosím vystaviť nález na posudok'), 'medical_report');
  assert.equal(parseVadkertiIntent('Chcem zrušiť termín'), 'appointment_change_or_cancellation');
  assert.equal(parseVadkertiIntent('Chcem sa objednať na vyšetrenie'), 'appointment_history');
});

test('Vadkerti NLU rozumie klucovym madarskym poziadavkam', () => {
  assert.equal(parseVadkertiIntent('MRI eredménnyel szeretnék kontrollra menni'), 'follow_up_with_results');
  assert.equal(parseVadkertiIntent('Gyógyszer receptet kérek'), 'prescription');
  assert.equal(parseVadkertiIntent('Szeretném lemondani az időpontot'), 'appointment_change_or_cancellation');
  assert.equal(parseAppointmentAction('lemondani'), 'cancel');
});

test('Urgentny stav, rok narodenia a socialny nalez sa deteguju konzervativne', () => {
  assert.equal(isVadkertiUrgent('Náhle mi ochrnula pravá strana a neviem rozprávať'), true);
  assert.equal(isVadkertiUrgent('Hirtelen beszédzavarom van'), true);
  assert.equal(isVadkertiUrgent('Potrebujem kontrolu budúci mesiac'), false);
  assert.equal(extractBirthYear('Narodil som sa v roku 1984.'), '1984');
  assert.equal(isSocialPurposeReport('nález na sociálne účely'), true);
});
