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

async function incoming(callSid, overrides = {}) {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910923456',
    ...overrides,
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/malakova/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

test.before(async () => {
  prixiService.getConfig = async phone => {
    assert.equal(phone, '+420910923456');
    return { clinicId: '161', voiceBotEnabled: true, timezone: 'Europe/Bratislava' };
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

test('produkčný endpoint routuje autoritatívny Malakova DID do oddeleného flow', async () => {
  const response = await incoming('CA-MALAKOVA-ROUTE-0000000000000001', {
    ForwardedFrom: '+421902647072',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /ambulancie MUDr\. Malákovej/);
  assert.match(response.body, /action="\/voice\/malakova\/answer"/);
  assert.doesNotMatch(response.body, /Vadkerti|Elissea/);
  assert.equal(app.hasRoute({ method: 'POST', url: '/voice/malakova/incoming' }), false);
});

test('volanie smerované cez reálne číslo ambulancie tiež spustí Malakova flow', async () => {
  const response = await incoming('CA-MALAKOVA-FORWARDED-000000000001', {
    To: '+420910929999',
    ForwardedFrom: '+421907692661',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /ambulancie MUDr\. Malákovej/);
});

test('zdravotné ťažkosti vytvoria clinic 161 požiadavku s dĺžkou 20 minút bez falošnej rezervácie', async () => {
  const callSid = 'CA-MALAKOVA-HEALTH-000000000000001';
  await incoming(callSid);
  await answer(callSid, '1', true);
  await answer(callSid, '1', true);
  const completion = await answer(callSid, 'Ján Novák');
  await new Promise(resolve => setImmediate(resolve));

  assert.match(completion.body, /Konkrétny termín zatiaľ nebol rezervovaný/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '161');
  assert.equal(sentEvents[0].routingPhoneNumber, '+421907692661');
  assert.equal(sentEvents[0].nameTranscript, 'Ján Novák');
  assert.match(sentEvents[0].problemTranscript, /Typ návštevy: zdravotné ťažkosti/);
  assert.match(sentEvents[0].problemTranscript, /Požadovaná dĺžka termínu: 20 minút/);
  assert.match(sentEvents[0].problemTranscript, /Konkrétny termín nebol rezervovaný/);
});

test('potvrdenie zachová požadovanú dĺžku 15 minút', async () => {
  const callSid = 'CA-MALAKOVA-CERTIFICATE-000000000001';
  await incoming(callSid);
  await answer(callSid, 'chcem sa objednať');
  await answer(callSid, 'potrebujem potvrdenie');
  await answer(callSid, 'Mária Horváthová');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Typ návštevy: potvrdenie/);
  assert.match(sentEvents[0].problemTranscript, /Požadovaná dĺžka termínu: 15 minút/);
});

test('predoperačné vyšetrenie vytvorí callback požiadavku', async () => {
  const callSid = 'CA-MALAKOVA-PREOP-0000000000000001';
  await incoming(callSid);
  await answer(callSid, '1', true);
  await answer(callSid, '3', true);
  const completion = await answer(callSid, 'Peter Krajčír');
  await new Promise(resolve => setImmediate(resolve));

  assert.match(completion.body, /eviduje vašu žiadosť o termín/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /predoperačné vyšetrenie/);
});

test('recept zachytí meno a názov lieku', async () => {
  const callSid = 'CA-MALAKOVA-PRESCRIPTION-00000000001';
  await incoming(callSid);
  const namePrompt = await answer(callSid, '2', true);
  assert.match(namePrompt.body, /meno a priezvisko/);
  const detailPrompt = await answer(callSid, 'Eva Malíková');
  assert.match(detailPrompt.body, /Aký liek potrebujete predpísať na recept/);
  assert.doesNotMatch(detailPrompt.body, /silu|gramáž|počet balení/);
  const completion = await answer(callSid, 'Prestarium');
  await new Promise(resolve => setImmediate(resolve));

  assert.match(completion.body, /recept vystavený elektronicky/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].nameTranscript, 'Eva Malíková');
  assert.match(sentEvents[0].problemTranscript, /Prestarium/);
});

test('spojenie s ambulanciou vytvorí žiadosť o telefonický kontakt', async () => {
  const callSid = 'CA-MALAKOVA-CONTACT-000000000000001';
  await incoming(callSid);
  await answer(callSid, 'chcem hovoriť s ambulanciou');
  const completion = await answer(callSid, 'Milan Kováč');
  await new Promise(resolve => setImmediate(resolve));

  assert.match(completion.body, /žiadosť o telefonický kontakt/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Kategória: žiadosť o telefonický kontakt/);
});

test('nesprávny clinicId zastaví flow bez zápisu požiadavky', async () => {
  const validGetConfig = prixiService.getConfig;
  prixiService.getConfig = async () => ({ clinicId: '999', voiceBotEnabled: true, timezone: 'Europe/Bratislava' });
  try {
    const response = await incoming('CA-MALAKOVA-WRONG-CLINIC-0000000001');
    assert.match(response.body, /Momentálne máme technické problémy/);
    assert.doesNotMatch(response.body, /\/voice\/malakova\/answer/);
    assert.equal(sentEvents.length, 0);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});

test('nedokončená zvolená požiadavka sa uloží iba raz pri call-status', async () => {
  const callSid = 'CA-MALAKOVA-ABANDONED-0000000000001';
  await incoming(callSid);
  await answer(callSid, '1', true);
  await answer(callSid, '4', true);
  const status = {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910923456',
    CallStatus: 'completed',
  };
  await post('/voice/call-status', status);
  await post('/voice/call-status', status);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Stav hovoru: NEDOKONČENÝ/);
  assert.match(sentEvents[0].problemTranscript, /preventívna prehliadka/);
});
