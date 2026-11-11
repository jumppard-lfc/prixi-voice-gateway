const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');
const { dentbodyAudioFileNames } = require('../../src/config/dentbody-audio.config');

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
  assert.match(response.body, /<Play>https:\/\/127\.0\.0\.1:3000\/media\/dentbody-01-greeting-v1\.wav<\/Play>/);
  assert.doesNotMatch(response.body, /<Say/);
  assert.match(response.body, /action="\/voice\/dentbody\/answer"/);
  assert.match(response.body, /input="speech dtmf"/);
  assert.match(response.body, /timeout="4"/);
  assert.match(response.body, /speechTimeout="1"/);
  assert.ok(response.body.indexOf('<Play') < response.body.indexOf('<Gather'));
  assert.doesNotMatch(response.body, /Kollára|Elissea|Vadkerti/);
});

test('všetkých 42 Dentbody nahrávok je dostupných v Twilio WAV formáte', async () => {
  assert.equal(dentbodyAudioFileNames.length, 42);

  for (const audioFileName of dentbodyAudioFileNames) {
    const response = await app.inject({ method: 'GET', url: `/media/${audioFileName}` });
    assert.equal(response.statusCode, 200, audioFileName);
    assert.match(response.headers['content-type'], /^audio\/wav/, audioFileName);
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable', audioFileName);

    const wav = response.rawPayload;
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF', audioFileName);
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE', audioFileName);
    const fmtOffset = wav.indexOf(Buffer.from('fmt '));
    assert.ok(fmtOffset >= 0, `${audioFileName}: missing fmt chunk`);
    assert.equal(wav.readUInt16LE(fmtOffset + 8), 7, `${audioFileName}: expected G.711 mu-law`);
    assert.equal(wav.readUInt16LE(fmtOffset + 10), 1, `${audioFileName}: expected mono`);
    assert.equal(wav.readUInt32LE(fmtOffset + 12), 8000, `${audioFileName}: expected 8 kHz`);
  }
});

test('otázka kde sa nachádza ambulancia dostane konkrétnu adresu', async () => {
  const callSid = 'CA-DENTBODY-ADDRESS-00000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Kde sa nachádza ambulancia?');

  assert.match(response.body, /dentbody-11-address-v1\.wav/);
  assert.match(response.body, /dentbody-02-follow-up-v1\.wav/);
  assert.doesNotMatch(response.body, /dentbody-04-retry-v1\.wav|dentbody-05-fallback-v1\.wav/);
});

test('zdvorilostné slovo uprostred otázky nezabráni odpovedi s adresou', async () => {
  const callSid = 'CA-DENTBODY-POLITE-ADDRESS-00000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Kde sa prosím nachádza ambulancia?');

  assert.match(response.body, /dentbody-11-address-v1\.wav/);
  assert.doesNotMatch(response.body, /dentbody-04-retry-v1\.wav/);
});

test('otázka na poschodie povie prvé poschodie aj potvrdenú adresu', async () => {
  const callSid = 'CA-DENTBODY-FLOOR-000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Na ktorom poschodí vás nájdem?');

  assert.match(response.body, /dentbody-12-floor-v1\.wav/);
  assert.doesNotMatch(response.body, /dentbody-04-retry-v1\.wav/);
});

test('objednanie a žiadanka dostanú obe schválené odpovede bez rezervácie', async () => {
  const callSid = 'CA-DENTBODY-BOOKING-00000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Musím sa objednať a potrebujem žiadanku?');

  assert.match(response.body, /dentbody-09-appointment-v1\.wav/);
  assert.match(response.body, /dentbody-10-referral-v1\.wav/);
  assert.match(response.body, /dentbody-02-follow-up-v1\.wav/);
  assert.match(response.body, /<Gather/);
  assert.doesNotMatch(response.body, /dentbody-06-closing-v1\.wav/);
});

test('nepochopená otázka ponúkne krátky číselný fallback', async () => {
  const callSid = 'CA-DENTBODY-RETRY-000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'modrá obloha');

  assert.match(response.body, /dentbody-04-retry-v1\.wav/);
});

test('číselný fallback pre snímky vysvetlí oba spôsoby výstupu', async () => {
  const callSid = 'CA-DENTBODY-DTMF-0000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, '3', true);

  assert.match(response.body, /dentbody-15-dental-images-v1\.wav/);
  assert.match(response.body, /dentbody-16-general-images-v1\.wav/);
  assert.match(response.body, /dentbody-17-radiology-report-v1\.wav/);
});

test('prirodzené nie ďakujem hovor slušne ukončí', async () => {
  const callSid = 'CA-DENTBODY-END-00000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Nie, ďakujem, to je všetko');

  assert.match(response.body, /dentbody-06-closing-v1\.wav/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /<Gather/);
});

test('už nepotrebujem nič viac ukončí hovor príjemnou rozlúčkou', async () => {
  const callSid = 'CA-DENTBODY-NOTHING-ELSE-000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Už nepotrebujem nič viac');

  assert.match(response.body, /dentbody-06-closing-v1\.wav/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /dentbody-04-retry-v1\.wav/);
  assert.doesNotMatch(response.body, /<Gather/);
});

test('nie to bude všetko ďakujem ukončí hovor bez chybového fallbacku', async () => {
  const callSid = 'CA-DENTBODY-THATS-ALL-0000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Nie, to bude všetko, ďakujem');

  assert.match(response.body, /dentbody-06-closing-v1\.wav/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /dentbody-04-retry-v1\.wav/);
  assert.doesNotMatch(response.body, /<Gather/);
});

test('už nie ďakujem pekne po doplňujúcej otázke ukončí hovor', async () => {
  const callSid = 'CA-DENTBODY-CONTEXT-END-00000000001';
  await incoming(callSid);
  const firstResponse = await answer(callSid, 'Môžem platiť kartou?');
  assert.match(firstResponse.body, /dentbody-02-follow-up-v1\.wav/);

  const response = await answer(callSid, 'Už nie, ďakujem pekne');
  assert.match(response.body, /dentbody-06-closing-v1\.wav/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /dentbody-04-retry-v1\.wav/);
  assert.doesNotMatch(response.body, /<Gather/);
});

test('záporný úvod s novou otázkou hovor neukončí', async () => {
  const callSid = 'CA-DENTBODY-CONTEXT-QUESTION-00001';
  await incoming(callSid);
  await answer(callSid, 'Môžem platiť kartou?');

  const response = await answer(callSid, 'Nie, ale kedy máte otvorené?');
  assert.match(response.body, /dentbody-23-hours-full-week-v1\.wav/);
  assert.match(response.body, /dentbody-02-follow-up-v1\.wav/);
  assert.match(response.body, /<Gather/);
  assert.doesNotMatch(response.body, /<Hangup/);
});

test('po deviatej otázke pokračuje a po desiatej odpovedi hovor ukončí', async () => {
  const callSid = 'CA-DENTBODY-LIMIT-0000000000000001';
  await incoming(callSid);

  let response;
  for (let question = 1; question <= 9; question += 1) {
    response = await answer(callSid, 'Môžem platiť kartou?');
    assert.match(response.body, /dentbody-02-follow-up-v1\.wav/);
    assert.match(response.body, /<Gather/);
    assert.doesNotMatch(response.body, /<Hangup/);
  }

  response = await answer(callSid, 'Potrebujem žiadanku?');
  assert.match(response.body, /dentbody-10-referral-v1\.wav/);
  assert.match(response.body, /dentbody-06-closing-v1\.wav/);
  assert.match(response.body, /<Hangup/);
  assert.doesNotMatch(response.body, /dentbody-02-follow-up-v1\.wav/);
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
    assert.match(response.body, /dentbody-08-technical-v1\.wav/);
    assert.doesNotMatch(response.body, /\/voice\/dentbody\/answer/);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});
