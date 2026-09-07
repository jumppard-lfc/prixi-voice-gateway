const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const { execSync } = require('node:child_process');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const appModule = require('../../src/app');
const serviceModule = require('../../src/services/prixi.service');
const sttModule = require('../../src/services/stt.service');

const app = appModule.default;
const prixiService = serviceModule.prixiService;
const sttService = sttModule.sttService;
const projectRoot = path.join(__dirname, '../..');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalTranscribeAudioUrl = sttService.transcribeAudioUrl.bind(sttService);

function buildSignature(url, params) {
  return twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
}

async function signedVoicePost(endpoint, params) {
  const url = `https://127.0.0.1:3000${endpoint}`;
  return app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': buildSignature(url, params),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

test.before(() => {
  prixiService.getConfig = async () => ({
    clinicId: 'test-clinic',
    voiceBotEnabled: false,
    timezone: 'Europe/Bratislava',
  });
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  sttService.transcribeAudioUrl = originalTranscribeAudioUrl;
  await app.close();
});

test('Build cez tsc prejde bez chyb', () => {
  execSync('npx tsc --pretty false', {
    cwd: projectRoot,
    stdio: 'pipe',
  });
});

test('Aplikacia sa inicializuje bez chyby', async () => {
  await app.ready();
  assert.equal(app.hasRoute({ method: 'GET', url: '/health' }), true);
});

test('GET /health vracia UP', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'UP' });
});

test('Klostermann audio je dostupne v Twilio-kompatibilnom WAV formate', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/media/klostermann-greeting-v5.wav',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^audio\/wav/);
  assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.ok(response.rawPayload.length > 100_000);
  assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
});

test('POST /voice/incoming s neplatnym podpisom vrati 403', async () => {
  const endpoint = '/voice/incoming';
  const params = {
    From: '+421900000001',
    CallSid: 'CA77777777777777777777777777777777',
  };

  const validSignature = buildSignature(`https://127.0.0.1:3000${endpoint}`, params);
  const invalidSignature = `${validSignature.slice(0, -1)}X`;

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': invalidSignature,
    },
    payload: 'From=%2B421900000001&CallSid=CA77777777777777777777777777777777',
  });

  assert.equal(response.statusCode, 403);
});

test('POST /voice/incoming s validnym podpisom vrati TwiML', async () => {
  const endpoint = '/voice/incoming';
  const params = {
    From: '+421900000001',
    CallSid: 'CA88888888888888888888888888888888',
  };

  const signature = buildSignature(`https://127.0.0.1:3000${endpoint}`, params);

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': signature,
    },
    payload: 'From=%2B421900000001&CallSid=CA88888888888888888888888888888888',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Response>/);
  assert.match(response.body, /Toto číslo je momentálne nedostupné\./);
});

test('Klostermann fallback prehra dodanu nahravku a ukonci hovor', async () => {
  const response = await signedVoicePost('/voice/incoming', {
    From: '+421900000005',
    To: '+420910924239',
    ForwardedFrom: '+421917950507',
    CallSid: 'CA99999999999999999999999999999990',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Play>https:\/\/127\.0\.0\.1:3000\/media\/klostermann-greeting-v5\.wav<\/Play>/);
  assert.match(response.body, /<Hangup\/>/);
  assert.doesNotMatch(response.body, /<Say/);
  assert.doesNotMatch(response.body, /<Record/);
});

test('Zdielane Twilio cislo bez Klostermann presmerovania ostava dostupne inym ambulanciam', async () => {
  prixiService.getConfig = async () => ({
    clinicId: '95',
    voiceBotEnabled: false,
    timezone: 'Europe/Bratislava',
  });

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000006',
      To: '+421800232793',
      CallSid: 'CA99999999999999999999999999999989',
    });

    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body, /Klostermann Orthodontics/);
    assert.match(response.body, /Toto číslo je momentálne nedostupné\./);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Neznama orphan konfiguracia nikdy nespusti nahravanie', async () => {
  prixiService.getConfig = async () => ({
    clinicId: 'orphan',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    greetingMessage: null,
  });

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000017',
      To: '+421999999999',
      ForwardedFrom: '+421988888888',
      CallSid: 'CA99999999999999999999999999999974',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Momentálne máme technické problémy\./);
    assert.doesNotMatch(response.body, /Pre zanechanie odkazu/);
    assert.doesNotMatch(response.body, /<Record/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Nove VipTel cislo Martina Pekarcika sa routuje vylucne na jeho ambulanciu', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: 64,
      voiceBotEnabled: true,
      timezone: 'Europe/Bratislava',
      greetingMessage: 'Pekarcik test greeting',
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000010',
      To: 'sip:0332289010@sip.twilio.com',
      CallSid: 'CA99999999999999999999999999999981',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+421940610160');
    assert.match(response.body, /Pekarcik test greeting/);
    assert.match(response.body, /forwardedFrom=%2B421940610160/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Cudzie ForwardedFrom neprepise autoritativne VipTel cislo Martina Pekarcika', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '64',
      voiceBotEnabled: true,
      timezone: 'Europe/Bratislava',
      greetingMessage: 'Pekarcik authoritative route',
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000014',
      To: '00421332289010',
      ForwardedFrom: '+420910924239',
      CallSid: 'CA99999999999999999999999999999977',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+421940610160');
    assert.match(response.body, /Pekarcik authoritative route/);
    assert.doesNotMatch(response.body, /<Play/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Cudzie dedikovane To cislo ma prednost pred Pekarcikovym ForwardedFrom', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '142',
      voiceBotEnabled: true,
      timezone: 'Europe/Bratislava',
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000015',
      To: '+420910927082',
      ForwardedFrom: '+421940610160',
      CallSid: 'CA99999999999999999999999999999976',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910927082');
    assert.match(response.body, /pediatrickej ambulancie doktorky Čelkovej/);
    assert.match(response.body, /forwardedFrom=%2B420910927082/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Pekarcikov routing zablokuje konfiguraciu cudzej ambulancie', async () => {
  prixiService.getConfig = async () => ({
    clinicId: '143',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    greetingMessage: 'Cudzia ambulancia',
  });

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000011',
      To: '+421332289010',
      CallSid: 'CA99999999999999999999999999999980',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Momentálne máme technické problémy\./);
    assert.doesNotMatch(response.body, /Cudzia ambulancia/);
    assert.doesNotMatch(response.body, /<Record/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Pekarcikov routing bez databazovej uvitacej hlasky nepouzije vseobecny fallback', async () => {
  prixiService.getConfig = async () => ({
    clinicId: '64',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    greetingMessage: null,
  });

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000018',
      To: '+421332289010',
      CallSid: 'CA99999999999999999999999999999973',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Momentálne máme technické problémy\./);
    assert.doesNotMatch(response.body, /Pre zanechanie odkazu/);
    assert.doesNotMatch(response.body, /<Record/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Ina telefonna linka nemoze vytvorit poziadavku v Pekarcikovej ambulancii', async () => {
  prixiService.getConfig = async () => ({
    clinicId: 64,
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    greetingMessage: 'Pekarcik test greeting',
  });

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000012',
      To: '+421800232793',
      CallSid: 'CA99999999999999999999999999999979',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Momentálne máme technické problémy\./);
    assert.doesNotMatch(response.body, /Pekarcik test greeting/);
    assert.doesNotMatch(response.body, /<Record/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Rozpracovany Pekarcikov hovor sa pri zmene clinicId neodosle', async () => {
  let sendEventCalls = 0;
  prixiService.getConfig = async () => ({
    clinicId: '143',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async () => {
    sendEventCalls += 1;
  };

  try {
    const endpoint = '/voice/recording-complete?forwardedFrom=%2B421940610160&pediatricMode=false&dentalMode=false';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000013',
      To: '+421332289010',
      CallSid: 'CA99999999999999999999999999999978',
      RecordingUrl: 'https://api.twilio.test/birth-year',
      RecordingDuration: '2',
    });

    assert.equal(response.statusCode, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sendEventCalls, 0);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
    prixiService.sendEvent = originalSendEvent;
  }
});

test('Platny Pekarcikov hovor vytvori udalost iba s clinicId 64', async () => {
  const sentEvents = [];
  prixiService.getConfig = async () => ({
    clinicId: 64,
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async (event) => {
    sentEvents.push(event);
  };
  sttService.transcribeAudioUrl = async () => '1980';

  try {
    const endpoint = '/voice/recording-complete?forwardedFrom=%2B421940610160&pediatricMode=false&dentalMode=false';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000016',
      To: '+421332289010',
      CallSid: 'CA99999999999999999999999999999975',
      RecordingUrl: 'https://api.twilio.test/birth-year',
      RecordingDuration: '2',
    });

    assert.equal(response.statusCode, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentEvents.length, 1);
    assert.equal(String(sentEvents[0].clinicId), '64');
    assert.equal(sentEvents[0].phone, '+421900000016');
    assert.equal(sentEvents[0].routingPhoneNumber, '+421940610160');
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
    prixiService.sendEvent = originalSendEvent;
    sttService.transcribeAudioUrl = originalTranscribeAudioUrl;
  }
});

test('Pediatricky rezim pyta udaje dietata v celom IVR toku', async () => {
  prixiService.getConfig = async () => ({
    clinicId: 'pediatric-test-clinic',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    pediatricMode: true,
  });

  try {
    const incoming = await signedVoicePost('/voice/incoming', {
      From: '+421900000002',
      ForwardedFrom: '+421900000099',
      CallSid: 'CA99999999999999999999999999999991',
    });
    assert.equal(incoming.statusCode, 200);
    assert.match(incoming.body, /pediatrickej ambulancie doktorky Čelkovej/);
    assert.match(incoming.body, /155 alebo 112/);
    assert.match(incoming.body, /pediatricMode=true/);

    const problemEndpoint = '/voice/record-problem?forwardedFrom=%2B421900000099&pediatricMode=true';
    const problem = await signedVoicePost(problemEndpoint, {
      From: '+421900000002',
      CallSid: 'CA99999999999999999999999999999992',
      RecordingUrl: 'https://api.twilio.test/problem',
      RecordingDuration: '12',
    });
    assert.equal(problem.statusCode, 200);
    assert.match(problem.body, /meno a priezvisko dieťaťa/);
    assert.match(problem.body, /pediatricMode=true/);

    const nameEndpoint = '/voice/record-name?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=12&forwardedFrom=%2B421900000099&pediatricMode=true';
    const name = await signedVoicePost(nameEndpoint, {
      From: '+421900000002',
      CallSid: 'CA99999999999999999999999999999993',
      RecordingUrl: 'https://api.twilio.test/name',
      RecordingDuration: '4',
    });
    assert.equal(name.statusCode, 200);
    assert.match(name.body, /rok narodenia dieťaťa/);
    assert.match(name.body, /pediatricMode=true/);

    const completeEndpoint = '/voice/recording-complete?problemDuration=12&nameDuration=4&pediatricMode=true';
    const complete = await signedVoicePost(completeEndpoint, {
      From: '+421900000002',
      CallSid: 'CA99999999999999999999999999999994',
      RecordingDuration: '2',
    });
    assert.equal(complete.statusCode, 200);
    assert.match(complete.body, /telefónne číslo, z ktorého voláte/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Twilio cislo MUDr. Celkovej automaticky aktivuje pediatricky voice bot', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '142',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000003',
      To: '+420910927082',
      ForwardedFrom: '+421905111222',
      CallSid: 'CA99999999999999999999999999999995',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910927082');
    assert.match(response.body, /pediatrickej ambulancie doktorky Čelkovej/);
    assert.match(response.body, /forwardedFrom=%2B420910927082/);
    assert.match(response.body, /pediatricMode=true/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Poziadavka MUDr. Celkovej sa pri nespravnom clinicId neodosle inej ambulancii', async () => {
  let sendEventCalls = 0;
  prixiService.getConfig = async () => ({
    clinicId: '999',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
    pediatricMode: true,
  });
  prixiService.sendEvent = async () => {
    sendEventCalls += 1;
  };

  try {
    const endpoint = '/voice/recording-complete?forwardedFrom=%2B420910927082&pediatricMode=true';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000003',
      To: '+420910927082',
      CallSid: 'CA99999999999999999999999999999996',
      RecordingUrl: 'https://api.twilio.test/birth-year',
      RecordingDuration: '2',
    });

    assert.equal(response.statusCode, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sendEventCalls, 0);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
    prixiService.sendEvent = originalSendEvent;
  }
});

test('Poziadavka MUDr. Novotneho sa pri nespravnom clinicId neodosle inej ambulancii', async () => {
  let sendEventCalls = 0;
  prixiService.getConfig = async () => ({
    clinicId: '999',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async () => {
    sendEventCalls += 1;
  };

  try {
    const endpoint = '/voice/recording-complete?forwardedFrom=%2B420910928021&pediatricMode=false&dentalMode=true';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000009',
      To: '+420910928021',
      CallSid: 'CA99999999999999999999999999999983',
      RecordingUrl: 'https://api.twilio.test/birth-year',
      RecordingDuration: '2',
    });

    assert.equal(response.statusCode, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sendEventCalls, 0);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
    prixiService.sendEvent = originalSendEvent;
  }
});

test('Twilio cislo MUDr. Benovej Baloghovej aktivuje ortopedicky voice bot', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '143',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
      pediatricMode: true,
    };
  };

  try {
    const incoming = await signedVoicePost('/voice/incoming', {
      From: '+421900000004',
      To: '+420910927739',
      CallSid: 'CA99999999999999999999999999999996',
    });

    assert.equal(incoming.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910927739');
    assert.match(incoming.body, /ortopedickej ambulancie pani doktorky Miroslavy Beňovej Baloghovej/);
    assert.match(incoming.body, /s čím vám môžeme pomôcť/);
    assert.match(incoming.body, /forwardedFrom=%2B420910927739/);
    assert.match(incoming.body, /pediatricMode=false/);

    const problemEndpoint = '/voice/record-problem?forwardedFrom=%2B420910927739&pediatricMode=false';
    const problem = await signedVoicePost(problemEndpoint, {
      From: '+421900000004',
      CallSid: 'CA99999999999999999999999999999997',
      RecordingUrl: 'https://api.twilio.test/problem',
      RecordingDuration: '12',
    });
    assert.equal(problem.statusCode, 200);
    assert.match(problem.body, /vaše meno a priezvisko/);

    const nameEndpoint = '/voice/record-name?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=12&forwardedFrom=%2B420910927739&pediatricMode=false';
    const name = await signedVoicePost(nameEndpoint, {
      From: '+421900000004',
      CallSid: 'CA99999999999999999999999999999998',
      RecordingUrl: 'https://api.twilio.test/name',
      RecordingDuration: '4',
    });
    assert.equal(name.statusCode, 200);
    assert.match(name.body, /váš rok narodenia/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Konfigurovane Twilio cislo MUDr. Novotneho aktivuje zubarsky voice bot', async () => {
  const previousPhoneNumber = process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER;
  process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER = '+420910927999';
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '112',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
      pediatricMode: true,
    };
  };

  try {
    const incoming = await signedVoicePost('/voice/incoming', {
      From: '+421900000007',
      To: '+420910927999',
      CallSid: 'CA99999999999999999999999999999987',
    });

    assert.equal(incoming.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910927999');
    assert.match(incoming.body, /zubnej ambulancie doktora Miroslava Novotného v Kvetoslavove/);
    assert.match(incoming.body, /nedostupný alebo obsadený/);
    assert.match(incoming.body, /forwardedFrom=%2B420910927999/);
    assert.match(incoming.body, /pediatricMode=false/);
    assert.match(incoming.body, /dentalMode=true/);

    const problemEndpoint = '/voice/record-problem?forwardedFrom=%2B420910927999&pediatricMode=false&dentalMode=true';
    const problem = await signedVoicePost(problemEndpoint, {
      From: '+421900000007',
      CallSid: 'CA99999999999999999999999999999986',
      RecordingUrl: 'https://api.twilio.test/problem',
      RecordingDuration: '12',
    });
    assert.equal(problem.statusCode, 200);
    assert.match(problem.body, /dentalMode=true/);

    const completeEndpoint = '/voice/recording-complete?forwardedFrom=%2B420910927999&pediatricMode=false&dentalMode=true';
    const complete = await signedVoicePost(completeEndpoint, {
      From: '+421900000007',
      CallSid: 'CA99999999999999999999999999999985',
      RecordingDuration: '0',
    });
    assert.equal(complete.statusCode, 200);
    assert.match(complete.body, /kontaktovať do 24 hodín/);
    assert.match(complete.body, /telefónnom čísle, z ktorého voláte/);
  } finally {
    if (previousPhoneNumber === undefined) {
      delete process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER;
    } else {
      process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER = previousPhoneNumber;
    }
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Predvolene Twilio cislo MUDr. Novotneho je +420910928021', async () => {
  const previousPhoneNumber = process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER;
  delete process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER;
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '112',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000008',
      To: '+420910928021',
      CallSid: 'CA99999999999999999999999999999984',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910928021');
    assert.match(response.body, /zubnej ambulancie doktora Miroslava Novotného v Kvetoslavove/);
    assert.match(response.body, /forwardedFrom=%2B420910928021/);
    assert.match(response.body, /dentalMode=true/);
  } finally {
    if (previousPhoneNumber !== undefined) {
      process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER = previousPhoneNumber;
    }
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Twilio cisla ambulancii su priradene spravnym providerom', async () => {
  const celkovaConfig = await originalGetConfig('+420910927082');
  const benovaBaloghovaConfig = await originalGetConfig('+420910927739');
  const novotnyConfig = await originalGetConfig('+420910928021');

  assert.equal(celkovaConfig.clinicId, '142');
  assert.equal(celkovaConfig.pediatricMode, true);
  assert.equal(benovaBaloghovaConfig.clinicId, '143');
  assert.equal(benovaBaloghovaConfig.pediatricMode, false);
  assert.equal(novotnyConfig.clinicId, '112');
  assert.equal(novotnyConfig.pediatricMode, false);
});
