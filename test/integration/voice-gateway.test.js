const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const os = require('node:os');
const { rmSync } = require('node:fs');
const { execSync } = require('node:child_process');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const appModule = require('../../src/app');
const serviceModule = require('../../src/services/prixi.service');
const auditModule = require('../../src/services/booking-audit.service');
const bookingNluModule = require('../../src/services/booking-nlu.service');
const frameworkModule = require('../../src/services/voice-bot-framework.service');

const app = appModule.default;
const prixiService = serviceModule.prixiService;
const bookingAuditService = auditModule.bookingAuditService;
const { parseDatePreference, parseSlotChoice, parseYesNo } = bookingNluModule;
const { bovClinicDemoConfig, buildFlowSummary, validateVoiceBotConfig } = frameworkModule;
const projectRoot = path.join(__dirname, '../..');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalBookingEnabled = process.env.BOOKING_ENABLED;

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
  // Booking is enabled in the developer's local shell for manual Twilio testing.
  // Keep the unrelated IVR scenarios independent from that external environment.
  delete process.env.BOOKING_ENABLED;
  prixiService.getConfig = async () => ({
    clinicId: 'test-clinic',
    voiceBotEnabled: false,
    timezone: 'Europe/Bratislava',
  });
});

test.after(async () => {
  if (originalBookingEnabled === undefined) delete process.env.BOOKING_ENABLED;
  else process.env.BOOKING_ENABLED = originalBookingEnabled;
  prixiService.getConfig = originalGetConfig;
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

test('rozumie beznym hlasovym variantom pre dopoludnie', () => {
  const expected = { kind: 'next_available', timeOfDay: 'morning' };
  assert.deepEqual(parseDatePreference('doobedie'), expected);
  assert.deepEqual(parseDatePreference('chcel by som termín doobeda'), expected);
  assert.deepEqual(parseDatePreference('dopoludnie'), expected);
  assert.equal(parseYesNo('Áno.'), true);
  assert.equal(parseYesNo('áno, prosím'), true);
});

test('vyberie termin podla nazvu skutocne ponuknuteho dna', () => {
  const slots = [
    { id: 'monday', startAt: '2026-09-07T07:40:00.000Z', serviceName: 'Kontrola' },
    { id: 'wednesday', startAt: '2026-09-09T07:40:00.000Z', serviceName: 'Kontrola' },
    { id: 'friday', startAt: '2026-09-11T07:40:00.000Z', serviceName: 'Kontrola' },
  ];

  assert.equal(parseSlotChoice('pondelok', slots), 0);
  assert.equal(parseSlotChoice('streda', slots), 1);
  assert.equal(parseSlotChoice('piatok', slots), 2);
});

test('framework overi konfiguraciu personalizovaneho demo bota', () => {
  const config = structuredClone(bovClinicDemoConfig);
  config.id = 'dentcare-bratislava-demo';
  config.clinic.displayName = 'DentCare Bratislava';
  config.clinic.specialty = 'zubná klinika';
  config.services = [{ id: 'dental-hygiene', label: 'Dentálna hygiena', durationMinutes: 45, voiceAliases: ['hygiena'] }];

  assert.deepEqual(validateVoiceBotConfig(config).errors, []);
  assert.ok(buildFlowSummary(config).includes('Záverečné zhrnutie termínu a záväzné vytvorenie rezervácie'));
});

test('interny builder je dostupny iba s explicitnym tokenom', async () => {
  const originalToken = process.env.VOICE_BOT_BUILDER_TOKEN;
  process.env.VOICE_BOT_BUILDER_TOKEN = 'builder-test-token';
  try {
    const denied = await app.inject({ method: 'GET', url: '/admin/voice-bot-builder' });
    assert.equal(denied.statusCode, 404);

    const page = await app.inject({ method: 'GET', url: '/admin/voice-bot-builder?token=builder-test-token' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /PriXi Voice Bot Builder/);

    const validated = await app.inject({
      method: 'POST',
      url: '/admin/voice-bot-builder/validate',
      headers: { authorization: 'Bearer builder-test-token' },
      payload: bovClinicDemoConfig,
    });
    assert.equal(validated.statusCode, 200);
    assert.equal(validated.json().valid, true);
  } finally {
    if (originalToken === undefined) delete process.env.VOICE_BOT_BUILDER_TOKEN;
    else process.env.VOICE_BOT_BUILDER_TOKEN = originalToken;
  }
});

test('ulozeny ICP demo bot prejde mock rezervaciou a potvrdi ju SMS', async () => {
  const originalBuilderToken = process.env.VOICE_BOT_BUILDER_TOKEN;
  const originalConfigDirectory = process.env.VOICE_BOT_CONFIG_DIR;
  const originalDemoSmsEnabled = process.env.DEMO_BOOKING_SMS_ENABLED;
  const demoDirectory = path.join(os.tmpdir(), `prixi-voice-bot-test-${process.pid}`);
  process.env.VOICE_BOT_BUILDER_TOKEN = 'demo-builder-token';
  process.env.VOICE_BOT_CONFIG_DIR = demoDirectory;
  process.env.DEMO_BOOKING_SMS_ENABLED = 'true';

  const config = structuredClone(bovClinicDemoConfig);
  config.id = 'dentcare-bratislava-demo';
  config.clinic.displayName = 'DentCare Bratislava';
  config.clinic.specialty = 'zubná klinika';
  config.services = [{ id: 'hygiene', label: 'Dentálna hygiena', durationMinutes: 45, voiceAliases: ['hygiena'] }];

  try {
    const saved = await app.inject({
      method: 'POST', url: '/admin/voice-bot-builder/save',
      headers: { authorization: 'Bearer demo-builder-token' }, payload: config,
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().webhookPath, '/voice/demo/dentcare-bratislava-demo/incoming');

    const loaded = await app.inject({
      method: 'GET', url: '/admin/voice-bot-builder/config/dentcare-bratislava-demo',
      headers: { authorization: 'Bearer demo-builder-token' },
    });
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.json().config.clinic.displayName, 'DentCare Bratislava');

    const callSid = 'CA99999999999999999999999999999986';
    const base = { From: '+421900000125', CallSid: callSid };
    const incoming = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/incoming', base);
    assert.match(incoming.body, /<Redirect>\/voice\/demo\/dentcare-bratislava-demo\/start<\/Redirect>/);

    const start = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/start', base);
    assert.match(start.body, /Dentálna hygiena/);
    const service = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(service.body, /Rozumela som správne/);
    const serviceConfirmed = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(serviceConfirmed.body, /najbližší termín/);
    const preference = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(preference.body, /Rozumela som správne/);
    const preferenceConfirmed = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(preferenceConfirmed.body, /demo termíny/);
    const slot = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(slot.body, /Rozumela som správne/);
    const slotConfirmed = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(slotConfirmed.body, /meno a priezvisko/);
    const name = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, SpeechResult: 'Ján Novák' });
    assert.match(name.body, /všeobecné podmienky/);
    const terms = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(terms.body, /Môžem tento demo termín záväzne vytvoriť/);
    const completed = await signedVoicePost('/voice/demo/dentcare-bratislava-demo/answer', { ...base, Digits: '1' });
    assert.match(completed.body, /potvrdenie vám posielame SMS správou/);
  } finally {
    rmSync(demoDirectory, { recursive: true, force: true });
    if (originalBuilderToken === undefined) delete process.env.VOICE_BOT_BUILDER_TOKEN;
    else process.env.VOICE_BOT_BUILDER_TOKEN = originalBuilderToken;
    if (originalConfigDirectory === undefined) delete process.env.VOICE_BOT_CONFIG_DIR;
    else process.env.VOICE_BOT_CONFIG_DIR = originalConfigDirectory;
    if (originalDemoSmsEnabled === undefined) delete process.env.DEMO_BOOKING_SMS_ENABLED;
    else process.env.DEMO_BOOKING_SMS_ENABLED = originalDemoSmsEnabled;
  }
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

test('kratke pípnutie pred odpovedou je dostupne ako WAV', async () => {
  const response = await app.inject({ method: 'GET', url: '/media/booking-prompt-tone.wav' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^audio\/wav/);
  assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.ok(response.rawPayload.length < 3_000);
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

test('booking flow funguje kompletne cez tlacidla a odosle mock SMS', async () => {
  const originalMockMode = process.env.BOOKIO_MOCK_MODE;
  process.env.BOOKIO_MOCK_MODE = 'true';
  const callSid = 'CA99999999999999999999999999999988';
  const base = { From: '+421900000123', CallSid: callSid };

  try {
    const start = await signedVoicePost('/voice/booking/start', base);
    assert.equal(start.statusCode, 200);
    assert.match(start.body, /stlačte 1/);
    assert.match(start.body, /<Play>https:\/\/127\.0\.0\.1:3000\/media\/booking-prompt-tone\.wav<\/Play>/);
    assert.match(start.body, /<Gather[^>]+numDigits="1"/);

    const service = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '2' });
    assert.match(service.body, /chcete objednať na kontrolu/);

    const serviceConfirmed = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '1' });
    assert.match(serviceConfirmed.body, /najbližší termín/);

    const preference = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '1' });
    assert.match(preference.body, /preferujete najbližší voľný termín/);

    const preferenceConfirmed = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '1' });
    assert.match(preferenceConfirmed.body, /Mám tieto termíny/);

    const slot = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '2' });
    assert.match(slot.body, /Rozumela som správne, že vám vyhovuje/);

    const slotConfirmed = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '1' });
    assert.match(slotConfirmed.body, /meno a priezvisko/);

    const name = await signedVoicePost('/voice/booking/answer', { ...base, SpeechResult: 'Ján Novák' });
    assert.match(name.body, /Ďakujem/);
    assert.match(name.body, /všeobecnými obchodnými podmienkami/);

    const terms = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '1' });
    assert.match(terms.body, /Ďakujem. Ešte krátko zhrniem vybraný termín/);
    assert.match(terms.body, /Môžem termín záväzne objednať/);

    const confirmation = await signedVoicePost('/voice/booking/answer', { ...base, Digits: '1' });
    assert.match(confirmation.body, /Potvrdenie vám posielame SMS správou/);
    assert.match(confirmation.body, /<Hangup\/>/);

    const events = bookingAuditService.get(callSid);
    assert.deepEqual(events.map(({ event }) => event), [
      'started', 'service_selected', 'slots_offered', 'slot_selected', 'identity_collected',
      'terms_accepted', 'booking_created', 'sms_sent', 'completed',
    ]);
  } finally {
    if (originalMockMode === undefined) delete process.env.BOOKIO_MOCK_MODE;
    else process.env.BOOKIO_MOCK_MODE = originalMockMode;
  }
});

test('nepochopena hlasova volba prejde na presny vstup cez klavesnicu', async () => {
  const callSid = 'CA99999999999999999999999999999987';
  const base = { From: '+421900000124', CallSid: callSid };

  const start = await signedVoicePost('/voice/booking/start', base);
  assert.equal(start.statusCode, 200);

  const retryWithDtmf = await signedVoicePost('/voice/booking/answer', {
    ...base,
    SpeechResult: 'niečo, čo nie je voľba vyšetrenia',
  });
  assert.match(retryWithDtmf.body, /Prosím, pre istotu teraz použite klávesnicu/);
  assert.match(retryWithDtmf.body, /<Gather[^>]+input="dtmf"/);
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
  const response = await signedVoicePost('/voice/incoming', {
    From: '+421900000006',
    To: '+421800232793',
    CallSid: 'CA99999999999999999999999999999989',
  });

  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /Klostermann Orthodontics/);
  assert.match(response.body, /Toto číslo je momentálne nedostupné\./);
});

test('Pediatricky rezim pyta udaje dietata v celom IVR toku', async () => {
  prixiService.getConfig = async () => ({
    clinicId: 'mudr-celkova',
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
      clinicId: 'mudr-celkova',
      voiceBotEnabled: false,
      timezone: 'Europe/Bratislava',
    };
  };

  try {
    const response = await signedVoicePost('/voice/incoming', {
      From: '+421900000003',
      To: '+420910927082',
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

test('Twilio cislo MUDr. Benovej Baloghovej aktivuje ortopedicky voice bot', async () => {
  let requestedPhoneNumber = null;
  prixiService.getConfig = async (phoneNumber) => {
    requestedPhoneNumber = phoneNumber;
    return {
      clinicId: 'mudr-benova-baloghova',
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

test('Twilio cisla ambulancii su priradene spravnym providerom', async () => {
  const celkovaConfig = await originalGetConfig('+420910927082');
  const benovaBaloghovaConfig = await originalGetConfig('+420910927739');

  assert.equal(celkovaConfig.clinicId, '142');
  assert.equal(celkovaConfig.pediatricMode, true);
  assert.equal(benovaBaloghovaConfig.clinicId, '143');
  assert.equal(benovaBaloghovaConfig.pediatricMode, false);
});
