const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');

const originalGetConfig = prixiService.getConfig.bind(prixiService);

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
    To: '+420910923269',
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/dentbody/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

test.before(async () => {
  await app.ready();
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  await app.close();
});

test('produkčný DID spustí prirodzený Dentbody informačný flow', async () => {
  const response = await incoming('CA-DENTBODY-ROUTE-0000000000000001');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Dentbody X-ray v Petržalke/);
  assert.match(response.body, /S čím vám môžem pomôcť/);
  assert.match(response.body, /action="\/voice\/dentbody\/answer"/);
  assert.match(response.body, /input="speech dtmf"/);
  assert.doesNotMatch(response.body, /Kollára|Elissea|Vadkerti/);
});

test('objednanie a žiadanka dostanú obe schválené odpovede bez rezervácie', async () => {
  const callSid = 'CA-DENTBODY-BOOKING-00000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Musím sa objednať a potrebujem žiadanku?');

  assert.match(response.body, /sa neobjednáva/);
  assert.match(response.body, /na počkanie/);
  assert.match(response.body, /aj bez žiadanky alebo výmenného lístka/);
  assert.match(response.body, /Môžem vám pomôcť ešte s niečím/);
  assert.match(response.body, /<Gather/);
  assert.doesNotMatch(response.body, /rezervovaný termín|meno a priezvisko/);
});

test('nepochopená otázka ponúkne krátky číselný fallback', async () => {
  const callSid = 'CA-DENTBODY-RETRY-000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'modrá obloha');

  assert.match(response.body, /otázke som nerozumela/);
  assert.match(response.body, /ordinačné hodiny stlačte jednotku/);
  assert.match(response.body, /adresu a kontakt štvorku/);
});

test('číselný fallback pre snímky vysvetlí oba spôsoby výstupu', async () => {
  const callSid = 'CA-DENTBODY-DTMF-0000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, '3', true);

  assert.match(response.body, /Zubné RTG snímky/);
  assert.match(response.body, /všeobecného RTG/);
  assert.match(response.body, /dvanástich až dvadsiatich štyroch hodín/);
});

test('prirodzené nie ďakujem hovor slušne ukončí', async () => {
  const callSid = 'CA-DENTBODY-END-00000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Nie, ďakujem, to je všetko');

  assert.match(response.body, /Ďakujem za zavolanie/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /<Gather/);
});

test('po deviatej otázke pokračuje a po desiatej odpovedi hovor ukončí', async () => {
  const callSid = 'CA-DENTBODY-LIMIT-0000000000000001';
  await incoming(callSid);

  let response;
  for (let question = 1; question <= 9; question += 1) {
    response = await answer(callSid, 'Môžem platiť kartou?');
    assert.match(response.body, /Môžem vám pomôcť ešte s niečím/);
    assert.match(response.body, /<Gather/);
    assert.doesNotMatch(response.body, /<Hangup/);
  }

  response = await answer(callSid, 'Potrebujem žiadanku?');
  assert.match(response.body, /aj bez žiadanky alebo výmenného lístka/);
  assert.match(response.body, /Ďakujem za zavolanie/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /Môžem vám pomôcť ešte s niečím/);
});

test('nesprávny clinic ID zastaví Dentbody flow', async () => {
  const validGetConfig = prixiService.getConfig;
  prixiService.getConfig = async () => ({
    clinicId: '999',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  try {
    const response = await incoming('CA-DENTBODY-WRONG-CLINIC-000000001');
    assert.match(response.body, /Momentálne máme technické problémy/);
    assert.doesNotMatch(response.body, /\/voice\/dentbody\/answer/);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});
