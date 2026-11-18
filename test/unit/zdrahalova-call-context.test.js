const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  buildZdrahalovaClosedMessage,
  classifyZdrahalovaRequest,
  formatZdrahalovaProblemTranscript,
  isZdrahalovaAcceptingRequests,
} = require('../../src/services/zdrahalova-call-context.service');

function at(iso) {
  return DateTime.fromISO(iso, { zone: 'Europe/Bratislava' });
}

test('fallback ordinačné hodiny MUDr. Zdráhalovej majú správne hranice', () => {
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-16T06:59:00')), false);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-16T07:00:00')), true);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-18T14:59:00')), true);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-18T15:00:00')), false);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-19T09:59:00')), false);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-19T10:00:00')), true);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-19T17:00:00')), false);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-20T12:59:00')), true);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-20T13:00:00')), false);
  assert.equal(isZdrahalovaAcceptingRequests(undefined, at('2026-11-21T10:00:00')), false);
});

test('kompletné ordinačné hodiny z PriXi majú prednosť pred fallbackom', () => {
  const config = {
    clinicId: '152',
    enabled: true,
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    availability: { status: 'open' },
    workingHours: {
      monday: { enabled: true, from: '08:00', to: '09:00' },
      tuesday: { enabled: false, from: null, to: null },
      wednesday: { enabled: false, from: null, to: null },
      thursday: { enabled: false, from: null, to: null },
      friday: { enabled: false, from: null, to: null },
      saturday: { enabled: false, from: null, to: null },
      sunday: { enabled: false, from: null, to: null },
    },
  };

  assert.equal(isZdrahalovaAcceptingRequests(config, at('2026-11-16T08:30:00')), true);
  assert.equal(isZdrahalovaAcceptingRequests(config, at('2026-11-16T09:30:00')), false);
  assert.equal(isZdrahalovaAcceptingRequests(config, at('2026-11-17T08:30:00')), false);
});

test('PriXi dostupnosť môže bot vypnúť aj počas bežných ordinačných hodín', () => {
  const config = {
    clinicId: '152',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    availability: { status: 'vacation', message: 'Ambulancia má dovolenku do piatku.' },
  };
  assert.equal(isZdrahalovaAcceptingRequests(config, at('2026-11-16T10:00:00')), false);
  const message = buildZdrahalovaClosedMessage(config);
  assert.match(message, /dovolenku do piatku/);
  assert.match(message, /www\.mudrzdrahalova\.sk/);
});

test('požiadavky sa rozdelia do štyroch dohodnutých skupín', () => {
  assert.equal(classifyZdrahalovaRequest('Prosím predpísať Ventolin.'), 'prescription');
  assert.equal(classifyZdrahalovaRequest('Potrebujem sa poradiť o horúčke.'), 'consultation');
  assert.equal(classifyZdrahalovaRequest('Chcem zmeniť termín preventívnej prehliadky.'), 'preventive_reschedule');
  assert.equal(classifyZdrahalovaRequest('Objednajte nás na predoperačné vyšetrenie.'), 'preoperative_or_control_blood_draw');
  assert.equal(classifyZdrahalovaRequest('Potrebujeme kontrolné odbery krvi.'), 'preoperative_or_control_blood_draw');
  assert.match(formatZdrahalovaProblemTranscript('Prosím predpísať Ventolin.'), /Kategória: predpis \/ recept/);
});
