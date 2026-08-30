const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  CELKOVA_CONTEXT_MESSAGES,
  classifyPediatricCallReason,
  getCelkovaContextMessage,
} = require('../../src/services/pediatric-call-context.service');

const at = (iso) => DateTime.fromISO(iso, { zone: 'Europe/Bratislava' });

test('rozpoznava akutne a planovane dovody bez ohladu na diakritiku', () => {
  assert.equal(classifyPediatricCallReason('Dieťa má horúčku a kašeľ'), 'acute');
  assert.equal(classifyPediatricCallReason('Chcem termin na ockovanie'), 'planned');
  assert.equal(classifyPediatricCallReason('Potrebujem sa niečo opýtať'), 'unknown');
});

test('akutny telefonat dopoludnia oznami osetrenie do 12:00', () => {
  assert.equal(
    getCelkovaContextMessage('Dieťa má teplotu', at('2026-08-31T10:00:00')),
    CELKOVA_CONTEXT_MESSAGES.acuteBeforeNoon
  );
  assert.equal(getCelkovaContextMessage('Chcem výsledky', at('2026-08-31T10:00:00')), null);
});

test('medzi 12:00 a 15:00 pouzije iba poobedny kontext', () => {
  assert.equal(
    getCelkovaContextMessage('Dieťa vracia', at('2026-08-31T13:00:00')),
    CELKOVA_CONTEXT_MESSAGES.acuteAfternoon
  );
  assert.equal(
    getCelkovaContextMessage('Volám kvôli očkovaniu', at('2026-08-31T13:00:00')),
    CELKOVA_CONTEXT_MESSAGES.afternoonSchedule
  );
});

test('po 16:00 posle akutny stav na detsku pohotovost v Ziline', () => {
  assert.equal(
    getCelkovaContextMessage('Akútna bolesť', at('2026-08-31T18:00:00')),
    CELKOVA_CONTEXT_MESSAGES.childEmergency
  );
});

test('od 20:00 do 7:00 komunikuje nemocnicneho lekara iba pri akutnom dovode', () => {
  assert.equal(
    getCelkovaContextMessage('Dieťa sa dusí', at('2026-08-31T21:00:00')),
    CELKOVA_CONTEXT_MESSAGES.hospitalEmergency
  );
  assert.equal(
    getCelkovaContextMessage('Potrebujem recept', at('2026-08-31T21:00:00')),
    CELKOVA_CONTEXT_MESSAGES.phoneHours
  );
});

test('mimo pracovnych hodin bez jasneho dovodu povie iba telefonicku dostupnost', () => {
  assert.equal(
    getCelkovaContextMessage('Chcem sa niečo opýtať', at('2026-08-30T11:00:00')),
    CELKOVA_CONTEXT_MESSAGES.phoneHours
  );
});
