const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { DateTime, Settings } = require('luxon');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const appModule = require('../../src/app');
const serviceModule = require('../../src/services/prixi.service');
const sttModule = require('../../src/services/stt.service');
const neurocentrumEdsModule = require('../../src/services/neurocentrum-eds.service');

const app = appModule.default;
const prixiService = serviceModule.prixiService;
const sttService = sttModule.sttService;
const neurocentrumEdsService = neurocentrumEdsModule.neurocentrumEdsService;
const projectRoot = path.join(__dirname, '../..');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalTranscribeAudioUrl = sttService.transcribeAudioUrl.bind(sttService);
const originalResolveNeurocentrum = neurocentrumEdsService.resolveByInboundPhoneNumber.bind(neurocentrumEdsService);
const originalGetNeurocentrumConfig = neurocentrumEdsService.getConfig.bind(neurocentrumEdsService);

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
  neurocentrumEdsService.resolveByInboundPhoneNumber = originalResolveNeurocentrum;
  neurocentrumEdsService.getConfig = originalGetNeurocentrumConfig;
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

test('Hmira audio hlasky su dostupne v Twilio-kompatibilnom WAV formate', async () => {
  const [greeting, completion] = await Promise.all([
    app.inject({ method: 'GET', url: '/media/hmira-1-greeting-v1.wav' }),
    app.inject({ method: 'GET', url: '/media/hmira-2-completion-v1.wav' }),
  ]);

  for (const response of [greeting, completion]) {
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /^audio\/wav/);
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.ok(response.rawPayload.length > 70_000);
    assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
  }
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
    const endpoint = '/voice/recording-complete?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=5&forwardedFrom=%2B421940610160&pediatricMode=false&dentalMode=false';
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
    const endpoint = '/voice/recording-complete?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=5&forwardedFrom=%2B421940610160&pediatricMode=false&dentalMode=false';
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

test('Zlozenie pocas nahravania problemu odosle ciastocnu poziadavku do PriXi', async () => {
  const sentEvents = [];
  prixiService.getConfig = async () => ({
    clinicId: '95',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async (event) => {
    sentEvents.push(event);
  };
  sttService.transcribeAudioUrl = async () => 'Potrebujem predpísať lieky.';

  try {
    const endpoint = '/voice/record-problem?forwardedFrom=%2B421911500609&pediatricMode=false&dentalMode=false';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000019',
      CallSid: 'CA99999999999999999999999999999974',
      RecordingUrl: 'https://api.twilio.test/problem-hangup',
      RecordingDuration: '7',
      Digits: 'hangup',
    });

    assert.equal(response.statusCode, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentEvents.length, 1);
    assert.equal(sentEvents[0].problemTranscript, 'Potrebujem predpísať lieky.');
    assert.equal(sentEvents[0].nameTranscript, '');
    assert.equal(sentEvents[0].birthYearTranscript, '');
    assert.equal(sentEvents[0].durationSeconds, 7);
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

test('Zlozenie pocas nahravania mena zachova problem aj meno a prazdny rok', async () => {
  const sentEvents = [];
  prixiService.getConfig = async () => ({
    clinicId: '95',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async (event) => {
    sentEvents.push(event);
  };
  sttService.transcribeAudioUrl = async (url) => url.includes('name-hangup')
    ? 'Eva Krupová'
    : 'Potrebujem predpísať lieky.';

  try {
    const endpoint = '/voice/record-name?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem-hangup-2&problemDuration=9&forwardedFrom=%2B421911500609&pediatricMode=false&dentalMode=false';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000020',
      CallSid: 'CA99999999999999999999999999999973',
      RecordingUrl: 'https://api.twilio.test/name-hangup',
      RecordingDuration: '2',
      Digits: 'hangup',
    });

    assert.equal(response.statusCode, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentEvents.length, 1);
    assert.equal(sentEvents[0].problemTranscript, 'Potrebujem predpísať lieky.');
    assert.equal(sentEvents[0].nameTranscript, 'Eva Krupová');
    assert.equal(sentEvents[0].birthYearTranscript, '');
    assert.equal(sentEvents[0].durationSeconds, 11);
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

test('Dobrovodska po jednej odpovedi prehra zaver a odosle poziadavku iba raz', async () => {
  const sentEvents = [];
  prixiService.getConfig = async () => ({
    clinicId: '95',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async (event) => {
    sentEvents.push(event);
  };
  sttService.transcribeAudioUrl = async () => 'Potrebujem výsledky vyšetrenia.';

  try {
    const callSid = 'CA99999999999999999999999999999972';
    const problemEndpoint = '/voice/record-problem?forwardedFrom=%2B421911500609&pediatricMode=false&dentalMode=false';
    const problemResponse = await signedVoicePost(problemEndpoint, {
      From: '+421900000021',
      CallSid: callSid,
      RecordingUrl: 'https://api.twilio.test/problem-before-prompt-hangup',
      RecordingDuration: '6',
    });

    assert.equal(problemResponse.statusCode, 200);
    assert.match(problemResponse.body, /dobrovodska-2-completion-v2\.wav/);
    assert.match(problemResponse.body, /<Hangup\/>/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentEvents.length, 1);
    assert.equal(sentEvents[0].problemTranscript, 'Potrebujem výsledky vyšetrenia.');
    assert.equal(sentEvents[0].nameTranscript, '');
    assert.equal(sentEvents[0].birthYearTranscript, '');

    const statusParams = {
      From: '+421900000021',
      CallSid: callSid,
      CallStatus: 'completed',
      CallDuration: '14',
    };
    const firstStatus = await signedVoicePost('/voice/call-status', statusParams);
    const duplicateStatus = await signedVoicePost('/voice/call-status', statusParams);

    assert.equal(firstStatus.statusCode, 204);
    assert.equal(duplicateStatus.statusCode, 204);
    assert.equal(sentEvents.length, 1);
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

test('EDS priradene Twilio cislo spusti Neurocentrum bez Render ENV premennej', async () => {
  const config = {
    clinicId: '42',
    assistantType: 'neurocentrum',
    enabled: true,
    timezone: 'Europe/Bratislava',
    availability: { status: 'open' },
    maxConcurrentCalls: 3,
    messages: {
      greeting: 'Databázové uvítanie Neurocentra.',
      existingPatientQuestion: 'Ste existujúcim pacientom?',
      newPatient: 'Prvovyšetrenie osobne.',
      vacation: 'Dovolenka.',
      afterHours: 'Mimo hodín.',
      busy: 'Obsadené.',
      technical: 'Technická chyba.',
      urgent: 'Volajte 155.',
      completion: 'Zaznamenané.',
    },
  };
  let resolvedNumber = null;
  let loadedNumber = null;
  neurocentrumEdsService.resolveByInboundPhoneNumber = async (phoneNumber) => {
    resolvedNumber = phoneNumber;
    return config;
  };
  neurocentrumEdsService.getConfig = async (phoneNumber) => {
    loadedNumber = phoneNumber;
    return config;
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000003',
      To: '+421900000444',
      CallSid: 'CA99999999999999999999999999999975',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(resolvedNumber, '+421900000444');
    assert.equal(loadedNumber, '+421900000444');
    assert.match(response.body, /Databázové uvítanie Neurocentra/);
    assert.match(response.body, /\/voice\/neurocentrum\/answer/);
  } finally {
    neurocentrumEdsService.resolveByInboundPhoneNumber = originalResolveNeurocentrum;
    neurocentrumEdsService.getConfig = originalGetNeurocentrumConfig;
  }
});

test('Twilio cislo MUDr. Celkovej automaticky aktivuje pediatricky voice bot bez EDS DID resolvera', async () => {
  let requestedPhoneNumber = null;
  let resolverCalls = 0;
  neurocentrumEdsService.resolveByInboundPhoneNumber = async () => {
    resolverCalls += 1;
    throw new Error('Existing production routes must not use the EDS DID resolver');
  };
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
    assert.equal(resolverCalls, 0);
    assert.match(response.body, /pediatrickej ambulancie doktorky Čelkovej/);
    assert.match(response.body, /forwardedFrom=%2B420910927082/);
    assert.match(response.body, /pediatricMode=true/);
  } finally {
    neurocentrumEdsService.resolveByInboundPhoneNumber = originalResolveNeurocentrum;
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
    const endpoint = '/voice/recording-complete?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=5&forwardedFrom=%2B420910927082&pediatricMode=true';
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
    const endpoint = '/voice/recording-complete?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=5&forwardedFrom=%2B420910928021&pediatricMode=false&dentalMode=true';
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

test('Poziadavka MDDr. Hmiru sa pri nespravnom clinicId neodosle inej ambulancii', async () => {
  let sendEventCalls = 0;
  prixiService.getConfig = async () => ({
    clinicId: '112',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  prixiService.sendEvent = async () => {
    sendEventCalls += 1;
  };

  try {
    const endpoint = '/voice/recording-complete?problemUrl=https%3A%2F%2Fapi.twilio.test%2Fproblem&problemDuration=5&forwardedFrom=%2B420910924407&pediatricMode=false&dentalMode=true';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000022',
      To: '+420910924407',
      CallSid: 'CA99999999999999999999999999999969',
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

test('Poziadavka MUDr. Zdrahalovej sa pri nespravnom clinicId neodosle inej ambulancii', async () => {
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
    const endpoint = '/voice/record-problem?forwardedFrom=%2B421911135193&pediatricMode=true&dentalMode=false';
    const response = await signedVoicePost(endpoint, {
      From: '+421900000152',
      To: '+420910926126',
      CallSid: 'CA99999999999999999999999999999152',
      RecordingUrl: 'https://api.twilio.test/zdrahalova-wrong-clinic',
      RecordingDuration: '5',
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
  sttService.transcribeAudioUrl = async () => 'Ján Novák, bolí ma zub.';
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
    assert.match(incoming.body, /virtuálna sestra PriXi z ambulancie doktora Novotného/);
    assert.match(incoming.body, /Povedzte mi, prosím, svoje meno a s čím vám môžem pomôcť/);
    assert.doesNotMatch(incoming.body, /Vašu požiadavku odovzdám doktorovi Novotnému/);
    assert.match(incoming.body, /timeout="3"/);
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
    assert.match(problem.body, /Rozumiem/);
    assert.match(problem.body, /Vašu požiadavku odovzdám doktorovi Novotnému/);
    assert.match(problem.body, /ozveme sa vám späť do 24 hodín/);
    assert.doesNotMatch(problem.body, /record-name/);
    assert.match(problem.body, /<Hangup\/>/);
    await new Promise(resolve => setImmediate(resolve));
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
    sttService.transcribeAudioUrl = originalTranscribeAudioUrl;
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
    assert.match(response.body, /virtuálna sestra PriXi z ambulancie doktora Novotného/);
    assert.match(response.body, /svoje meno a s čím vám môžem pomôcť/);
    assert.match(response.body, /timeout="3"/);
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

test('Presmerovanie z cisla ambulancie MDDr. Hmiru aktivuje jeho zubarsky voice bot', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '151',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
      pediatricMode: true,
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000020',
      To: '+420910900001',
      ForwardedFrom: '+421948834475',
      CallSid: 'CA99999999999999999999999999999971',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910924407');
    assert.match(response.body, /<Play>.*\/media\/hmira-1-greeting-v1\.wav<\/Play>/);
    assert.doesNotMatch(response.body, /virtuálna sestra PriXi/);
    assert.match(response.body, /timeout="3"/);
    assert.match(response.body, /forwardedFrom=%2B420910924407/);
    assert.match(response.body, /pediatricMode=false/);
    assert.match(response.body, /dentalMode=true/);
  } finally {
    prixiService.getConfig = async () => ({
      clinicId: 'test-clinic',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    });
  }
});

test('Dedikovane Twilio cislo MDDr. Hmiru routuje a dokonci poziadavku iba pre jeho ambulanciu', async () => {
  sttService.transcribeAudioUrl = async () => 'Ján Novák, bolí ma zub.';
  let requestedPhoneNumber = null;
  let sentEvent = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '151',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    };
  };
  prixiService.sendEvent = async (event) => {
    sentEvent = event;
  };

  try {
    const incoming = await signedVoicePost('/voice/incoming', {
      From: '+421900000021',
      To: '+420910924407',
      ForwardedFrom: '+420910924239',
      CallSid: 'CA99999999999999999999999999999970',
    });

    assert.equal(incoming.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+420910924407');
    assert.match(incoming.body, /<Play>.*\/media\/hmira-1-greeting-v1\.wav<\/Play>/);
    assert.doesNotMatch(incoming.body, /Novotného/);
    assert.match(incoming.body, /forwardedFrom=%2B420910924407/);

    const problem = await signedVoicePost('/voice/record-problem?forwardedFrom=%2B420910924407&pediatricMode=false&dentalMode=true', {
      From: '+421900000021',
      CallSid: 'CA99999999999999999999999999999970',
      RecordingUrl: 'https://api.twilio.test/hmira-problem',
      RecordingDuration: '12',
    });

    assert.equal(problem.statusCode, 200);
    assert.match(problem.body, /<Play>.*\/media\/hmira-2-completion-v1\.wav<\/Play>/);
    assert.doesNotMatch(problem.body, /Novotnému/);
    assert.doesNotMatch(problem.body, /<Say/);
    assert.doesNotMatch(problem.body, /record-name/);
    assert.match(problem.body, /<Hangup\/>/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentEvent.clinicId, '151');
    assert.equal(sentEvent.routingPhoneNumber, '+420910924407');
    assert.equal(sentEvent.problemTranscript, 'Ján Novák, bolí ma zub.');
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

test('MUDr. Zdrahalova sa opyta iba raz a po poziadavke hovor ukonci', async () => {
  sttService.transcribeAudioUrl = async () => 'Ema Zelená, potrebujem predpísať lieky.';
  let requestedPhoneNumber = null;
  let sentEvent = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: '152',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
      pediatricMode: false,
      greetingMessage: 'Toto je dlhá všeobecná hláška, ktorá sa pre túto ambulanciu nesmie použiť.',
    };
  };
  prixiService.sendEvent = async (event) => {
    sentEvent = event;
  };

  try {
    const incoming = await signedVoicePost('/voice/incoming', {
      From: '+421900000193',
      To: '+420910926126',
      ForwardedFrom: '+420910927082',
      CallSid: 'CA99999999999999999999999999999193',
    });

    assert.equal(incoming.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+421911135193');
    assert.match(incoming.body, /virtuálna sestra PriXi z ambulancie doktorky Zdráhalovej/);
    assert.match(incoming.body, /meno dieťaťa a s čím vám môžeme pomôcť/);
    assert.doesNotMatch(incoming.body, /dlhá všeobecná hláška/);
    assert.doesNotMatch(incoming.body, /život ohrozujúci stav|ordinačné|rok narodenia/);
    assert.match(incoming.body, /timeout="3"/);
    assert.match(incoming.body, /forwardedFrom=%2B421911135193/);
    assert.match(incoming.body, /pediatricMode=true/);

    const forwardedIncoming = await signedVoicePost('/voice/incoming', {
      From: '+421900000194',
      To: '+420910920194',
      ForwardedFrom: '+421911135193',
      CallSid: 'CA99999999999999999999999999999194',
    });

    assert.equal(forwardedIncoming.statusCode, 200);
    assert.equal(requestedPhoneNumber, '+421911135193');
    assert.match(forwardedIncoming.body, /ambulancie doktorky Zdráhalovej/);
    assert.match(forwardedIncoming.body, /forwardedFrom=%2B421911135193/);

    const problem = await signedVoicePost('/voice/record-problem?forwardedFrom=%2B421911135193&pediatricMode=true&dentalMode=false', {
      From: '+421900000193',
      CallSid: 'CA99999999999999999999999999999193',
      RecordingUrl: 'https://api.twilio.test/zdrahalova-problem',
      RecordingDuration: '11',
    });

    assert.equal(problem.statusCode, 200);
    assert.match(problem.body, /Vašu požiadavku odovzdám ambulancii doktorky Zdráhalovej/);
    assert.doesNotMatch(problem.body, /record-name|recording-complete|rok narodenia/);
    assert.match(problem.body, /<Hangup\/>/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentEvent.clinicId, '152');
    assert.equal(sentEvent.routingPhoneNumber, '+421911135193');
    assert.equal(sentEvent.problemTranscript, 'Ema Zelená, potrebujem predpísať lieky.');
    assert.equal(sentEvent.nameTranscript, '');
    assert.equal(sentEvent.birthYearTranscript, '');
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

test('Twilio cisla ambulancii su priradene spravnym providerom', async () => {
  const vadkertiTwilioConfig = await originalGetConfig('+420910922693');
  const vadkertiClinicConfig = await originalGetConfig('+421902647072');
  const celkovaConfig = await originalGetConfig('+420910927082');
  const benovaBaloghovaConfig = await originalGetConfig('+420910927739');
  const novotnyConfig = await originalGetConfig('+420910928021');
  const hmiraTwilioConfig = await originalGetConfig('+420910924407');
  const hmiraClinicConfig = await originalGetConfig('+421948834475');
  const zdrahalovaTwilioConfig = await originalGetConfig('+420910926126');
  const zdrahalovaClinicConfig = await originalGetConfig('+421911135193');

  assert.equal(vadkertiTwilioConfig.clinicId, '146');
  assert.equal(vadkertiTwilioConfig.voiceBotEnabled, true);
  assert.equal(vadkertiClinicConfig.clinicId, '146');
  assert.equal(celkovaConfig.clinicId, '142');
  assert.equal(celkovaConfig.pediatricMode, true);
  assert.equal(benovaBaloghovaConfig.clinicId, '143');
  assert.equal(benovaBaloghovaConfig.pediatricMode, false);
  assert.equal(novotnyConfig.clinicId, '112');
  assert.equal(novotnyConfig.pediatricMode, false);
  assert.equal(hmiraTwilioConfig.clinicId, '151');
  assert.equal(hmiraTwilioConfig.pediatricMode, false);
  assert.equal(hmiraClinicConfig.clinicId, '151');
  assert.equal(zdrahalovaTwilioConfig.clinicId, '152');
  assert.equal(zdrahalovaTwilioConfig.pediatricMode, true);
  assert.equal(zdrahalovaClinicConfig.clinicId, '152');
});

test('MUDr. Dobrovodska pouziva dvojkrokovy audio flow', async () => {
  const originalGetConfig = prixiService.getConfig;
  const originalNow = Settings.now;
  prixiService.getConfig = async () => ({
    clinicId: '95',
    voiceBotEnabled: true,
    timezone: 'Europe/Bratislava',
  });
  // The route intentionally rejects calls outside the clinic's hours. Freeze
  // this media-routing test inside that window so it is deterministic.
  const officeHoursTimestamp = DateTime.fromISO('2026-09-16T09:00:00+02:00').toMillis();
  Settings.now = () => officeHoursTimestamp;

  try {
    const [greetingMedia, completionMedia] = await Promise.all([
      app.inject({ method: 'GET', url: '/media/dobrovodska-1-greeting-v2.wav' }),
      app.inject({ method: 'GET', url: '/media/dobrovodska-2-completion-v2.wav' }),
    ]);
    for (const response of [greetingMedia, completionMedia]) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-type'], 'audio/wav');
      assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
    }

    const incomingRes = await signedVoicePost('/voice/incoming', {
      From: '+421900000088',
      To: '+421800232793',
    });
    assert.equal(incomingRes.statusCode, 200);
    assert.match(incomingRes.body, /<Play>.*\/media\/dobrovodska-1-greeting-v2\.wav<\/Play>/);
    assert.match(incomingRes.body, /<Record[^>]+\/voice\/record-problem/);
    assert.doesNotMatch(incomingRes.body, /record-name|recording-complete/);
  } finally {
    prixiService.getConfig = originalGetConfig;
    Settings.now = originalNow;
  }
});
