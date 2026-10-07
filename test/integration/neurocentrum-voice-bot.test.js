const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { neurocentrumEdsService } = require('../../src/services/neurocentrum-eds.service');
const { neurocentrumSessionService } = require('../../src/services/neurocentrum-session.service');

const originalGetConfig = neurocentrumEdsService.getConfig.bind(neurocentrumEdsService);
const originalResolveByInboundPhoneNumber = neurocentrumEdsService.resolveByInboundPhoneNumber.bind(neurocentrumEdsService);
const originalSendPatientRequest = neurocentrumEdsService.sendPatientRequest.bind(neurocentrumEdsService);
let sentEvents = [];

function runtimeConfig(overrides = {}) {
  return {
    clinicId: '42',
    assistantType: 'neurocentrum',
    enabled: true,
    timezone: 'Europe/Bratislava',
    availability: { status: 'open' },
    maxConcurrentCalls: 3,
    messages: {
      greeting: 'Dobrý deň, dovolali ste sa do neurologickej ambulancie Neurocentrum Levice.',
      existingPatientQuestion: 'Ste už existujúcim pacientom našej ambulancie? Odpovedzte áno alebo nie.',
      newPatient: 'V prípade prvovyšetrenia objednať sa je možné len osobne v ordinačných hodinách s platným výmenným lístkom.',
      vacation: 'Momentálne neordinujeme.',
      afterHours: 'Zavolajte, prosím, počas ordinačných hodín.',
      busy: 'Všetky linky sú momentálne obsadené.',
      technical: 'Požiadavku sa nám momentálne nepodarilo zaznamenať.',
      urgent: 'Okamžite volajte tiesňovú linku 155 alebo 112.',
      completion: 'Ďakujem. Vašu požiadavku sme zaznamenali.',
    },
    ...overrides,
  };
}

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

function incoming(callSid, from = '+421905111222') {
  return post('/voice/incoming', { CallSid: callSid, From: from, To: '+420910999333' });
}

function answer(callSid, speech) {
  return post('/voice/neurocentrum/answer', { CallSid: callSid, From: '+421905111222', SpeechResult: speech });
}

function callStatus(callSid) {
  return post('/voice/call-status', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910999333',
    CallStatus: 'completed',
  });
}

async function fillRequest(callSid) {
  await incoming(callSid);
  await answer(callSid, 'áno');
  await answer(callSid, 'Ján Novák');
  await answer(callSid, '15. 3. 1980');
  await answer(callSid, 'recept');
  return answer(callSid, 'Tegretol 200 miligramov, dve balenia');
}

test.before(async () => {
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  neurocentrumSessionService.resetForTests();
  neurocentrumEdsService.resetForTests();
  neurocentrumEdsService.resolveByInboundPhoneNumber = async () => runtimeConfig();
  neurocentrumEdsService.getConfig = async () => runtimeConfig();
  neurocentrumEdsService.sendPatientRequest = async event => {
    sentEvents.push(event);
    return 'created';
  };
});

test.after(async () => {
  neurocentrumEdsService.getConfig = originalGetConfig;
  neurocentrumEdsService.resolveByInboundPhoneNumber = originalResolveByInboundPhoneNumber;
  neurocentrumEdsService.sendPatientRequest = originalSendPatientRequest;
  await app.close();
});

test('spoločný produkčný endpoint načíta EDS konfiguráciu a routuje Neurocentrum flow', async () => {
  let requestedPhone;
  neurocentrumEdsService.getConfig = async phone => {
    requestedPhone = phone;
    return runtimeConfig();
  };
  const response = await incoming('CA-NEURO-ROUTE-001');
  assert.equal(response.statusCode, 200);
  assert.equal(requestedPhone, '+420910999333');
  assert.match(response.body, /<Say language="cs-CZ" voice="Google.cs-CZ-Wavenet-B">Dobrý deň, dovolali ste sa do neurologickej ambulancie Neurocentrum Levice\.<\/Say>/);
  assert.match(response.body, /<Say language="sk-SK" voice="Google.sk-SK-Wavenet-B">Ste .*existujúcim pacientom/);
  assert.match(response.body, /existujúcim pacientom/);
  assert.match(response.body, /action="\/voice\/neurocentrum\/answer"/);
});

test('prvovyšetrenie použije hlášku z EDS a nevytvorí požiadavku', async () => {
  const callSid = 'CA-NEURO-NEW-001';
  await incoming(callSid);
  const response = await answer(callSid, 'nie som');
  assert.match(response.body, /prvovyšetrenia/);
  assert.match(response.body, /platným výmenným lístkom/);
  assert.equal(sentEvents.length, 0);
});

test('po rozpoznaných odpovediach použije krátke prirodzené potvrdenia', async () => {
  const callSid = 'CA-NEURO-ACKS-001';
  await incoming(callSid);

  const existingPatient = await answer(callSid, 'áno');
  assert.match(existingPatient.body, /Ďakujem/);
  assert.match(existingPatient.body, /meno a priezvisko/);

  const name = await answer(callSid, 'Ján Novák');
  assert.match(name.body, /Ďakujem/);
  assert.match(name.body, /dátum narodenia/);

  const birthDate = await answer(callSid, '15. 3. 1980');
  assert.match(birthDate.body, /Rozumiem/);
  assert.match(birthDate.body, /potrebujete vybaviť/);

  const requestType = await answer(callSid, 'recept');
  assert.match(requestType.body, /Rozumiem, ide o predpis liekov/);
  assert.match(requestType.body, /názvy liekov a počet balení/);
  assert.doesNotMatch(requestType.body, /dávkovanie/);

  const detail = await answer(callSid, 'Tegretol 200 miligramov, dve balenia');
  assert.match(detail.body, /Vašu požiadavku sme zaznamenali/);
  assert.doesNotMatch(detail.body, /Zhrniem vašu požiadavku/);
});

test('požiadavka sa odošle do EDS hneď po nadiktovaní detailu', async () => {
  const callSid = 'CA-NEURO-RX-001';
  const completed = await fillRequest(callSid);
  assert.match(completed.body, /Vašu požiadavku sme zaznamenali/);
  assert.doesNotMatch(completed.body, /Sú tieto údaje správne/);
  assert.equal(sentEvents.length, 1);
  assert.deepEqual(sentEvents[0], {
    event: 'patient_request.created',
    version: 1,
    clinicId: '42',
    callSid,
    occurredAt: sentEvents[0].occurredAt,
    call: {
      phone: '+421905111222',
      durationSeconds: sentEvents[0].call.durationSeconds,
    },
    patient: {
      existingPatient: true,
      firstName: 'Ján',
      lastName: 'Novák',
      birthDate: '1980-03-15',
    },
    request: {
      type: 'prescription',
      detail: 'Tegretol 200 miligramov, dve balenia',
    },
  });
});

test('pri kontrole sa požiadavka odošle bez otázky na dôvod alebo obdobie', async () => {
  const callSid = 'CA-NEURO-FOLLOW-UP-001';
  await incoming(callSid);
  await answer(callSid, 'áno');
  await answer(callSid, 'Ján Novák');
  await answer(callSid, '15. 3. 1980');

  const completed = await answer(callSid, 'kontrola');

  assert.match(completed.body, /Vašu požiadavku sme zaznamenali/);
  assert.doesNotMatch(completed.body, /o akú kontrolu ide/);
  assert.doesNotMatch(completed.body, /aké obdobie vám vyhovuje/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].request.type, 'follow_up');
  assert.equal(sentEvents[0].request.detail, 'Pacient žiada o objednanie na kontrolu.');
});

test('dovolenka a čas mimo ordinačných hodín sa vyhodnocujú podľa EDS availability', async t => {
  await t.test('dovolenka', async () => {
    neurocentrumEdsService.getConfig = async () => runtimeConfig({ availability: { status: 'vacation', message: 'Dovolenka do 5. októbra.' } });
    const response = await incoming('CA-NEURO-VACATION-001');
    assert.match(response.body, /Dovolenka do 5. októbra/);
    assert.doesNotMatch(response.body, /<Gather/);
  });
  await t.test('mimo hodín', async () => {
    neurocentrumEdsService.getConfig = async () => runtimeConfig({ availability: { status: 'outside_hours', message: 'Ambulancia je teraz zatvorená.' } });
    const response = await incoming('CA-NEURO-AFTER-001');
    assert.match(response.body, /Ambulancia je teraz zatvorená/);
    assert.doesNotMatch(response.body, /<Gather/);
  });
});

test('bez dostupnej EDS konfigurácie sa hovor bezpečne ukončí', async () => {
  neurocentrumEdsService.getConfig = async () => { throw new Error('EDS unavailable'); };
  const response = await incoming('CA-NEURO-CONFIG-FAIL-001');
  assert.match(response.body, /technický problém/);
  assert.doesNotMatch(response.body, /<Gather/);
});

test('pri zlyhaní EDS event API bot nepotvrdí prijatie požiadavky', async () => {
  neurocentrumEdsService.sendPatientRequest = async () => { throw new Error('EDS unavailable'); };
  const callSid = 'CA-NEURO-EVENT-FAIL-001';
  const response = await fillRequest(callSid);
  assert.match(response.body, /nepodarilo zaznamenať/);
  assert.doesNotMatch(response.body, /Vašu požiadavku sme zaznamenali/);
});

test('duplicitný CallSid z EDS sa považuje za úspešne uloženú požiadavku', async () => {
  neurocentrumEdsService.sendPatientRequest = async event => {
    sentEvents.push(event);
    return 'duplicate';
  };
  const callSid = 'CA-NEURO-DUPLICATE-001';
  const response = await fillRequest(callSid);
  assert.match(response.body, /Vašu požiadavku sme zaznamenali/);
  assert.equal(sentEvents.length, 1);
});

test('štvrtý súbežný hovor dostane EDS busy hlášku a status callback uvoľní slot', async () => {
  await incoming('CA-NEURO-LIMIT-001');
  await incoming('CA-NEURO-LIMIT-002');
  await incoming('CA-NEURO-LIMIT-003');
  const busy = await incoming('CA-NEURO-LIMIT-004');
  assert.match(busy.body, /linky sú momentálne obsadené/);
  assert.doesNotMatch(busy.body, /<Gather/);

  assert.equal((await callStatus('CA-NEURO-LIMIT-001')).statusCode, 204);
  assert.match((await incoming('CA-NEURO-LIMIT-005')).body, /<Gather/);
});

test('urgentný príznak hovor ukončí bez zápisu do EDS', async () => {
  const callSid = 'CA-NEURO-URGENT-001';
  await incoming(callSid);
  const response = await answer(callSid, 'Náhle som ochrnul a neviem rozprávať');
  assert.match(response.body, /155 alebo 112/);
  assert.equal(sentEvents.length, 0);
});

test('pôvodné gateway admin endpointy nie sú aktívne', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/admin/neurocentrum/settings' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/neurocentrum' })).statusCode, 404);
});
