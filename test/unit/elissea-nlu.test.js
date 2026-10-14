const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractElisseaBirthYear,
  parseElisseaAdministrativeType,
  parseElisseaAppointmentType,
  parseElisseaMainMenu,
  parseElisseaYesNo,
} = require('../../src/services/elissea-nlu.service');

test('Elissea áno/nie podporuje hlas aj DTMF', () => {
  assert.equal(parseElisseaYesNo('áno'), true);
  assert.equal(parseElisseaYesNo('1'), true);
  assert.equal(parseElisseaYesNo('nie som'), false);
  assert.equal(parseElisseaYesNo('2'), false);
});

test('Elissea menu rozpozná kategórie a typy termínov', () => {
  assert.equal(parseElisseaMainMenu('chcem sa objednať'), 'appointment');
  assert.equal(parseElisseaMainMenu('potrebujem recept'), 'administrative');
  assert.equal(parseElisseaMainMenu('3'), 'certificate');
  assert.equal(parseElisseaAdministrativeType('PN'), 'sick_leave');
  assert.equal(parseElisseaAppointmentType('preventívna prehliadka'), 'preventive_exam');
  assert.equal(parseElisseaAppointmentType('1'), 'acute_exam');
});

test('Elissea extrahuje platný rok narodenia', () => {
  assert.equal(extractElisseaBirthYear('narodil som sa v roku 1985'), '1985');
  assert.equal(extractElisseaBirthYear('osemnásť'), undefined);
});
