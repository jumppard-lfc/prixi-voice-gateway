const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');
const { mailerSendService } = require('../../src/services/mailersend.service');

const originalGetVoiceAssistantConfig = prixiService.getVoiceAssistantConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalIsLenerovaConfigured = mailerSendService.isLenerovaConfigured.bind(mailerSendService);
const originalSendLenerovaRequest = mailerSendService.sendLenerovaRequest.bind(mailerSendService);
let sentEvents = [];
let emailedEvents = [];
let configuredClinicId = '172';
let configuredAssistantType = 'lenerova';
const configuredWorkingHours = {
  monday: { enabled: true, from: '07:00', to: '12:00' },
  tuesday: { enabled: true, from: '07:00', to: '12:00' },
  wednesday: { enabled: true, from: '07:00', to: '12:00' },
  thursday: { enabled: true, from: '07:00', to: '12:00' },
  friday: { enabled: true, from: '07:00', to: '12:00' },
  saturday: { enabled: false, from: null, to: null },
  sunday: { enabled: false, from: null, to: null },
};

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
      workingHours: configuredWorkingHours,
    };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  mailerSendService.isLenerovaConfigured = () => true;
  mailerSendService.sendLenerovaRequest = async event => {
    emailedEvents.push(event);
    return 'mailer-message-172';
  };
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  emailedEvents = [];
  configuredClinicId = '172';
  configuredAssistantType = 'lenerova';
  prixiService.sendEvent = async event => sentEvents.push(event);
  mailerSendService.isLenerovaConfigured = () => true;
  mailerSendService.sendLenerovaRequest = async event => {
    emailedEvents.push(event);
    return 'mailer-message-172';
  };
});

test.after(async () => {
  prixiService.getVoiceAssistantConfig = originalGetVoiceAssistantConfig;
  prixiService.sendEvent = originalSendEvent;
  mailerSendService.isLenerovaConfigured = originalIsLenerovaConfigured;
  mailerSendService.sendLenerovaRequest = originalSendLenerovaRequest;
  await app.close();
});

test('spoločný produkčný webhook routuje Lenerovej DID do samostatného live flow', async () => {
  const response = await incoming('CA-LENEROVA-ROUTE-000000000000001');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /virtuálnej sestričke pani doktorky Lenerovej/);
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
  assert.equal(emailedEvents.length, 1);
  assert.equal(emailedEvents[0], sentEvents[0]);
});

test('objednanie liekov sa rozpozná ako recept, nie ako termín', async () => {
  const callSid = 'CA-LENEROVA-MEDICATION-ORDER-00000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Chcel by som si objednať lieky');

  assert.match(response.body, /meno a priezvisko pacienta/i);
  assert.doesNotMatch(response.body, /pravidelnú kontrolu|požiadavku na termín/i);
  assert.equal(sentEvents.length, 0);
  assert.equal(emailedEvents.length, 0);
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

test('otázka na ordinačné hodiny dostane priamu odpoveď z EDS a ponuku ďalšej pomoci', async () => {
  const callSid = 'CA-LENEROVA-INFORMATION-00000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Kedy ordinujete?');

  assert.match(response.body, /od pondelka do piatka od siedmej do dvanástej/i);
  assert.match(response.body, /v sobotu a v nedeľu neordinujeme/i);
  assert.match(response.body, /Je to všetko, alebo vám môžem pomôcť ešte s niečím/i);
  assert.match(response.body, /<Gather/);
  assert.equal(sentEvents.length, 0);
  assert.equal(emailedEvents.length, 0);
});

test('po informácii môže volajúci rovno prejsť na ďalšiu požiadavku', async () => {
  const callSid = 'CA-LENEROVA-INFORMATION-CONTINUE-00001';
  await incoming(callSid);
  await answer(callSid, 'Kedy ordinujete?');
  const next = await answer(callSid, 'Potrebujem recept');

  assert.match(next.body, /meno a priezvisko pacienta/i);
  assert.doesNotMatch(next.body, /akú organizačnú informáciu potrebujete/i);
  assert.equal(sentEvents.length, 0);
});

test('po informácii sa hovor na nie ďakujem slušne ukončí', async () => {
  const callSid = 'CA-LENEROVA-INFORMATION-END-000000001';
  await incoming(callSid);
  await answer(callSid, 'Kedy ordinujete?');
  const ending = await answer(callSid, 'Nie, ďakujem, to je všetko');

  assert.match(ending.body, /Prajem príjemný deň/i);
  assert.match(ending.body, /<Hangup/);
  assert.doesNotMatch(ending.body, /<Gather/);
  assert.equal(sentEvents.length, 0);
});

test('po desiatej informačnej odpovedi sa hovor ukončí bez ďalšej otázky', async () => {
  const callSid = 'CA-LENEROVA-INFORMATION-LIMIT-0000001';
  await incoming(callSid);

  for (let index = 1; index < 10; index += 1) {
    const response = await answer(callSid, 'Kedy ordinujete?');
    assert.match(response.body, /môžem pomôcť ešte s niečím/i);
    assert.match(response.body, /<Gather/);
  }

  const finalResponse = await answer(callSid, 'Kedy ordinujete?');
  assert.match(finalResponse.body, /od pondelka do piatka od siedmej do dvanástej/i);
  assert.match(finalResponse.body, /Prajem príjemný deň/i);
  assert.match(finalResponse.body, /<Hangup/);
  assert.doesNotMatch(finalResponse.body, /môžem pomôcť ešte s niečím|<Gather/i);
  assert.equal(sentEvents.length, 0);
  assert.equal(emailedEvents.length, 0);
});

test('organizačná otázka bez potvrdenej odpovede nezahlcuje ambulanciu', async () => {
  const callSid = 'CA-LENEROVA-UNKNOWN-INFORMATION-00001';
  await incoming(callSid);
  const detailPrompt = await answer(callSid, '7', true);
  assert.match(detailPrompt.body, /akú organizačnú informáciu potrebujete/i);
  const response = await answer(callSid, 'Kto vás zastupuje počas dovolenky?');

  assert.match(response.body, /aktuálnom zastupovaní zatiaľ nemám spoľahlivo potvrdenú/i);
  assert.match(response.body, /môžem pomôcť ešte s niečím/i);
  assert.doesNotMatch(response.body, /požiadavku som odoslala ambulancii/i);
  assert.equal(sentEvents.length, 0);
  assert.equal(emailedEvents.length, 0);
});

test('ani nedokončená informačná voľba sa cez call-status neodošle ambulancii', async () => {
  const callSid = 'CA-LENEROVA-ABANDONED-INFORMATION-0001';
  await incoming(callSid);
  await answer(callSid, '7', true);

  await post('/voice/call-status', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910924316',
    CallStatus: 'completed',
  });

  assert.equal(sentEvents.length, 0);
  assert.equal(emailedEvents.length, 0);
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
  await answer(callSid, 'Potrebujem lekársku správu');
  await answer(callSid, 'Ján Novák');
  await answer(callSid, '1980');
  const completion = await answer(callSid, 'Potrebujem správu pre zamestnávateľa');

  assert.match(completion.body, /technický problém/);
  assert.doesNotMatch(completion.body, /požiadavku som odoslala/);
  assert.equal(emailedEvents.length, 0);
});

test('chyba MailerSend nezahodí požiadavku uloženú v PriXi', async () => {
  mailerSendService.sendLenerovaRequest = async () => {
    throw new Error('MailerSend unavailable');
  };
  const callSid = 'CA-LENEROVA-MAIL-FAILURE-00000000001';
  await incoming(callSid);
  await answer(callSid, 'Potrebujem lekársku správu');
  await answer(callSid, 'Ján Novák');
  await answer(callSid, '1980');
  const completion = await answer(callSid, 'Potrebujem správu pre zamestnávateľa');

  assert.match(completion.body, /požiadavku som odoslala ambulancii/);
  assert.equal(sentEvents.length, 1);
  assert.equal(emailedEvents.length, 0);
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
  assert.equal(emailedEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Stav hovoru: NEDOKONČENÝ/);
  assert.match(sentEvents[0].problemTranscript, /zmena alebo zrušenie existujúceho termínu/);
});
