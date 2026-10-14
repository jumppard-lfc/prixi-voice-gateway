const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
let sentEvents = [];

function signature(url, params) {
  return twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
}

async function post(endpoint, params) {
  const url = `https://127.0.0.1:3000${endpoint}`;
  return app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': signature(url, params),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

async function incoming(callSid) {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910927882',
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/elissea/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

async function identifyExistingPatient(callSid) {
  await incoming(callSid);
  await answer(callSid, '1', true);
  await answer(callSid, 'Ján Železník');
  return answer(callSid, '1980');
}

test.before(async () => {
  prixiService.getConfig = async phone => {
    assert.equal(phone, '+420910927882');
    return { clinicId: '148', voiceBotEnabled: true, timezone: 'Europe/Bratislava' };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  await app.close();
});

test('produkčný endpoint routuje Elissea DID do oddeleného flow', async () => {
  const response = await post('/voice/incoming', {
    CallSid: 'CA-ELISSEA-ROUTE-00000000000000001',
    From: '+421905111222',
    To: '+420910927882',
    ForwardedFrom: '+421902647072',
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Elissea Clinic/);
  assert.match(response.body, /action="\/voice\/elissea\/answer"/);
  assert.doesNotMatch(response.body, /Vadkerti/);
  assert.equal(app.hasRoute({ method: 'POST', url: '/voice/elissea/incoming' }), false);
});

test('objednanie vytvorí PriXi požiadavku, ale nepredstiera rezervovaný termín', async () => {
  const callSid = 'CA-ELISSEA-APPOINTMENT-000000000001';
  const menuResponse = await identifyExistingPatient(callSid);
  assert.match(menuResponse.body, /Ak sa chcete objednať/);
  await answer(callSid, '1', true);
  const completion = await answer(callSid, '1', true);
  await new Promise(resolve => setImmediate(resolve));

  assert.match(completion.body, /Konkrétny termín zatiaľ nebol rezervovaný/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '148');
  assert.equal(sentEvents[0].nameTranscript, 'Ján Železník');
  assert.equal(sentEvents[0].birthYearTranscript, '1980');
  assert.match(sentEvents[0].problemTranscript, /Typ termínu: akútne vyšetrenie/);
  assert.match(sentEvents[0].problemTranscript, /Konkrétny termín nebol rezervovaný/);
});

test('PN vysvetlí nutnosť vyšetrenia a vytvorí akútnu požiadavku', async () => {
  const callSid = 'CA-ELISSEA-SICK-LEAVE-0000000000001';
  await identifyExistingPatient(callSid);
  await answer(callSid, '2', true);
  const completion = await answer(callSid, '2', true);
  await new Promise(resolve => setImmediate(resolve));

  assert.match(completion.body, /najprv nutné objednať sa na vyšetrenie/);
  assert.match(completion.body, /Konkrétny termín zatiaľ nebol rezervovaný/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /PN – objednanie na akútne vyšetrenie/);
  assert.match(sentEvents[0].problemTranscript, /Typ termínu: akútne vyšetrenie/);
});

test('recept zachytí názov, silu a počet balení', async () => {
  const callSid = 'CA-ELISSEA-PRESCRIPTION-00000000001';
  await identifyExistingPatient(callSid);
  await answer(callSid, '2', true);
  const detailPrompt = await answer(callSid, '1', true);
  assert.match(detailPrompt.body, /názov lieku, jeho silu alebo gramáž a počet balení/);
  await answer(callSid, 'Prestarium 5 miligramov, dve balenia');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Prestarium 5 miligramov, dve balenia/);
});

test('nový pacient uvedie iba identitu a požiadavku bez otázky na samoplatcu', async () => {
  const callSid = 'CA-ELISSEA-NEW-PATIENT-000000000001';
  await incoming(callSid);
  await answer(callSid, '2', true);
  await answer(callSid, 'Mária Nováková');
  const detailPrompt = await answer(callSid, '1992');
  assert.match(detailPrompt.body, /Pár vetami opíšte/);
  assert.doesNotMatch(detailPrompt.body, /samoplat|registrova/iu);
  await answer(callSid, 'Chcem sa objednať pre bolesti chrbta');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Pacient ambulancie: nie/);
  assert.match(sentEvents[0].problemTranscript, /požiadavka nového pacienta/);
});

test('nesprávny clinicId zastaví flow bez zápisu požiadavky', async () => {
  const validGetConfig = prixiService.getConfig;
  prixiService.getConfig = async () => ({ clinicId: '999', voiceBotEnabled: true, timezone: 'Europe/Bratislava' });
  try {
    const response = await incoming('CA-ELISSEA-WRONG-CLINIC-00000000001');
    assert.match(response.body, /Momentálne máme technické problémy/);
    assert.doesNotMatch(response.body, /\/voice\/elissea\/answer/);
    assert.equal(sentEvents.length, 0);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});

test('nedokončená zvolená požiadavka sa uloží iba raz pri call-status', async () => {
  const callSid = 'CA-ELISSEA-ABANDONED-0000000000001';
  await identifyExistingPatient(callSid);
  await answer(callSid, '3', true);
  const status = {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910927882',
    CallStatus: 'completed',
  };
  await post('/voice/call-status', status);
  await post('/voice/call-status', status);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Stav hovoru: NEDOKONČENÝ/);
  assert.match(sentEvents[0].problemTranscript, /tlačivo alebo posudok/);
});
