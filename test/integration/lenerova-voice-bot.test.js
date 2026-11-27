const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');

const originalGetVoiceAssistantConfig = prixiService.getVoiceAssistantConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
let sentEvents = [];
let configuredClinicId = '172';
let configuredAssistantType = 'lenerova';

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

async function incoming(callSid, overrides = {}) {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910924316',
    ...overrides,
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/lenerova/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

test.before(async () => {
  prixiService.getVoiceAssistantConfig = async phone => {
    assert.equal(phone, '+420910924316');
    return {
      clinicId: configuredClinicId,
      assistantType: configuredAssistantType,
      enabled: true,
      voiceBotEnabled: true,
      timezone: 'Europe/Bratislava',
      availability: { status: 'open' },
    };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  configuredClinicId = '172';
  configuredAssistantType = 'lenerova';
  prixiService.sendEvent = async event => sentEvents.push(event);
});

test.after(async () => {
  prixiService.getVoiceAssistantConfig = originalGetVoiceAssistantConfig;
  prixiService.sendEvent = originalSendEvent;
  await app.close();
});

test('spoločný produkčný webhook routuje Lenerovej DID do samostatného live flow', async () => {
  const response = await incoming('CA-LENEROVA-ROUTE-000000000000001');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /psychiatrickej ambulancie pani doktorky Lenerovej/);
  assert.match(response.body, /action="\/voice\/lenerova\/answer"/);
  assert.doesNotMatch(response.body, /\/voice\/demo\//);
  assert.equal(app.hasRoute({ method: 'POST', url: '/voice/lenerova/incoming' }), false);
});

test('presmerovanie z ambulantného mobilu spustí rovnaký produkčný flow', async () => {
  const response = await incoming('CA-LENEROVA-FORWARDED-00000000001', {
    To: '+420910999991',
    ForwardedFrom: '+421907808677',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /pani doktorky Lenerovej/);
  assert.match(response.body, /\/voice\/lenerova\/answer/);
});

test('recept odošle meno, rok narodenia a detail do PriXi kliniky 172', async () => {
  const callSid = 'CA-LENEROVA-PRESCRIPTION-0000000001';
  await incoming(callSid);
  assert.match((await answer(callSid, '1', true)).body, /meno a priezvisko pacienta/);
  assert.match((await answer(callSid, 'Ján Novák')).body, /rok narodenia pacienta/);
  assert.match((await answer(callSid, '1980')).body, /názov pravidelne užívaného lieku/);
  const completion = await answer(
    callSid,
    'Sertralín päťdesiat miligramov raz denne, zostávajú mi tri tablety'
  );

  assert.match(completion.body, /žiadosť o recept som odoslala ambulancii/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '172');
  assert.equal(sentEvents[0].routingPhoneNumber, '+421907808677');
  assert.equal(sentEvents[0].phone, '+421905111222');
  assert.equal(sentEvents[0].nameTranscript, 'Ján Novák');
  assert.equal(sentEvents[0].birthYearTranscript, '1980');
  assert.match(sentEvents[0].problemTranscript, /Kategória: žiadosť o opakovaný recept/);
  assert.match(sentEvents[0].problemTranscript, /Sertralín/);
  assert.doesNotMatch(sentEvents[0].problemTranscript, /Demo požiadavka/);
});

test('žiadosť o termín nevytvorí rezerváciu ani neponúka voľné sloty', async () => {
  const callSid = 'CA-LENEROVA-APPOINTMENT-00000000001';
  await incoming(callSid);
  await answer(callSid, 'chcem termín kontroly');
  await answer(callSid, 'Mária Kováčová');
  await answer(callSid, '1975');
  const completion = await answer(callSid, 'najlepšie niekedy budúci mesiac dopoludnia');

  assert.match(completion.body, /Toto nie je potvrdenie rezervácie/);
  assert.doesNotMatch(completion.body, /voľný termín|rezervácia je potvrdená/i);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /žiadosť o termín kontroly/);
  assert.match(sentEvents[0].problemTranscript, /Konkrétny termín nebol rezervovaný/);
});

test('organizačná otázka sa uloží ako požiadavka bez vymyslenej odpovede', async () => {
  const callSid = 'CA-LENEROVA-INFORMATION-00000000001';
  await incoming(callSid);
  const detailPrompt = await answer(callSid, 'ordinačné hodiny');
  assert.match(detailPrompt.body, /akú organizačnú informáciu potrebujete/);
  const completion = await answer(callSid, 'Kedy ordinujete v Malackách?');

  assert.match(completion.body, /požiadavku som odoslala ambulancii/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].nameTranscript, '');
  assert.equal(sentEvents[0].birthYearTranscript, '');
  assert.match(sentEvents[0].problemTranscript, /organizačná informácia/);
  assert.match(sentEvents[0].problemTranscript, /Kedy ordinujete v Malackách/);
});

test('iný clinicId alebo assistantType zablokuje flow pred vytvorením požiadavky', async () => {
  configuredClinicId = '999';
  let response = await incoming('CA-LENEROVA-WRONG-CLINIC-000000001');
  assert.match(response.body, /technický problém/);
  assert.doesNotMatch(response.body, /\/voice\/lenerova\/answer/);

  configuredClinicId = '172';
  configuredAssistantType = 'iny-bot';
  response = await incoming('CA-LENEROVA-WRONG-TYPE-0000000001');
  assert.match(response.body, /technický problém/);
  assert.equal(sentEvents.length, 0);
});

test('pri chybe PriXi bot nepotvrdí, že bola požiadavka odoslaná', async () => {
  prixiService.sendEvent = async () => {
    throw new Error('PriXi unavailable');
  };
  const callSid = 'CA-LENEROVA-PRIXI-FAILURE-000000001';
  await incoming(callSid);
  await answer(callSid, '7', true);
  const completion = await answer(callSid, 'Potrebujem informáciu o zastupovaní');

  assert.match(completion.body, /technický problém/);
  assert.doesNotMatch(completion.body, /požiadavku som odoslala/);
});

test('nedokončená zvolená požiadavka sa uloží iba raz cez call-status', async () => {
  const callSid = 'CA-LENEROVA-ABANDONED-000000000001';
  await incoming(callSid);
  await answer(callSid, '3', true);
  const status = {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910924316',
    CallStatus: 'completed',
  };
  await post('/voice/call-status', status);
  await post('/voice/call-status', status);

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Stav hovoru: NEDOKONČENÝ/);
  assert.match(sentEvents[0].problemTranscript, /zmena alebo zrušenie existujúceho termínu/);
});
