const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { neurocentrumEdsService } = require('../../src/services/neurocentrum-eds.service');
const { kutakovaSessionService } = require('../../src/services/kutakova-session.service');
const { prixiService } = require('../../src/services/prixi.service');

const originalSendPatientRequest = neurocentrumEdsService.sendPatientRequest.bind(neurocentrumEdsService);
const originalGetVoiceAssistantConfig = prixiService.getVoiceAssistantConfig.bind(prixiService);
let sentEvents = [];
let runtimeConfig;

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

function incoming(callSid) {
  return post('/voice/incoming', {
    From: '+421905111222',
    To: '+420910924343',
    CallSid: callSid,
  });
}

function answer(callSid, speech) {
  return post('/voice/kutakova/answer', {
    From: '+421905111222',
    To: '+420910924343',
    CallSid: callSid,
    SpeechResult: speech,
  });
}

test.beforeEach(() => {
  sentEvents = [];
  runtimeConfig = {
    clinicId: '158',
    healthcareProviderId: 158,
    voiceBotEnabled: true,
    enabled: true,
    assistantType: 'kutakova',
    timezone: 'Europe/Bratislava',
    availability: { status: 'open', message: null },
    maxConcurrentCalls: 20,
    messages: {
      greeting: 'Konfigurované uvítanie ambulancie doktorky Kutákovej.',
      afterHours: 'Konfigurovaná hláška mimo ordinačných hodín.',
      technical: 'Konfigurovaná technická chyba.',
      urgent: 'Konfigurovaná urgentná hláška.',
      completion: 'Konfigurované potvrdenie predregistrácie.',
    },
  };
  kutakovaSessionService.resetForTests();
  prixiService.getVoiceAssistantConfig = async phoneNumber => {
    assert.equal(phoneNumber, '+420910924343');
    return runtimeConfig;
  };
  neurocentrumEdsService.sendPatientRequest = async event => {
    sentEvents.push(event);
    return 'created';
  };
});

test.after(async () => {
  neurocentrumEdsService.sendPatientRequest = originalSendPatientRequest;
  prixiService.getVoiceAssistantConfig = originalGetVoiceAssistantConfig;
  await app.close();
});

test('Kutakova bot vytvori potvrdenu predregistraciu pre clinic 158 cez EDS', async () => {
  const callSid = 'CA-KUTAKOVA-PREREG-00000000000001';
  const start = await incoming(callSid);
  assert.equal(start.statusCode, 200);
  assert.match(start.body, /Pre slovenčinu/);
  assert.match(start.body, /For English/);

  const language = await answer(callSid, 'slovensky');
  assert.match(language.body, /Konfigurované uvítanie/);
  assert.match(language.body, /Súhlasíte/);

  assert.match((await answer(callSid, 'áno')).body, /meno a priezvisko/);
  assert.match((await answer(callSid, 'Jana Nováková')).body, /celý dátum narodenia/);
  assert.match((await answer(callSid, '12. 4. 1985')).body, /zdravotnej poisťovni/);
  assert.match((await answer(callSid, 'Dôvera')).body, /obec alebo mesto/);

  const summary = await answer(callSid, 'Bratislava');
  assert.match(summary.body, /Meno Jana Nováková/);
  assert.match(summary.body, /Poisťovňa Dôvera/);
  assert.match(summary.body, /Bydlisko Bratislava/);
  assert.equal(sentEvents.length, 0);

  const completed = await answer(callSid, 'áno');
  assert.match(completed.body, /Konfigurované potvrdenie predregistrácie/);
  assert.equal(sentEvents.length, 1);
  assert.deepEqual(sentEvents[0], {
    event: 'patient_request.created',
    version: 1,
    clinicId: '158',
    callSid,
    occurredAt: sentEvents[0].occurredAt,
    call: {
      phone: '+421905111222',
      durationSeconds: sentEvents[0].call.durationSeconds,
    },
    patient: {
      existingPatient: false,
      firstName: 'Jana',
      lastName: 'Nováková',
      birthDate: '1985-04-12',
    },
    request: {
      type: 'pre_registration',
      detail: [
        'PREDREGISTRÁCIA NOVÉHO PACIENTA pred otvorením ambulancie.',
        'Nejde o potvrdenú registráciu ani objednanie na vyšetrenie.',
        'Jazyk hovoru: SK.',
        'Poisťovňa: Dôvera.',
        'Bydlisko: Bratislava.',
        `Súhlas so zaznamenaním údajov a spätným kontaktom: áno (${sentEvents[0].request.detail.match(/\(([^)]+)\)/)[1]}).`,
      ].join('\n'),
    },
  });
});

test('Kutakova bot bez suhlasu neodosle ziadne osobne udaje', async () => {
  const callSid = 'CA-KUTAKOVA-NO-CONSENT-0000000001';
  await incoming(callSid);
  await answer(callSid, 'slovensky');
  const response = await answer(callSid, 'nie');

  assert.match(response.body, /Bez vášho súhlasu údaje nezaznamenáme/);
  assert.equal(sentEvents.length, 0);
  assert.equal(kutakovaSessionService.get(callSid), undefined);
});

test('Kutakova bot nepotvrdi predregistraciu ked EDS zapis zlyha', async () => {
  neurocentrumEdsService.sendPatientRequest = async () => {
    throw new Error('EDS unavailable');
  };
  const callSid = 'CA-KUTAKOVA-EDS-FAILURE-000000000001';
  await incoming(callSid);
  await answer(callSid, 'slovensky');
  await answer(callSid, 'áno');
  await answer(callSid, 'Jana Nováková');
  await answer(callSid, '12. 4. 1985');
  await answer(callSid, 'Dôvera');
  await answer(callSid, 'Bratislava');
  const response = await answer(callSid, 'áno');

  assert.match(response.body, /Konfigurovaná technická chyba/);
  assert.doesNotMatch(response.body, /bezpečne zaznamenali/);
});

test('Kutakova bot pouzije admin hlasku mimo ordinacnych hodin a pokracuje v predregistracii', async () => {
  runtimeConfig.availability = { status: 'outside_hours', message: 'Konfigurovaná hláška mimo ordinačných hodín.' };
  const callSid = 'CA-KUTAKOVA-AFTER-HOURS-000000000001';

  await incoming(callSid);
  const response = await answer(callSid, 'slovensky');

  assert.match(response.body, /Konfigurovaná hláška mimo ordinačných hodín/);
  assert.match(response.body, /Súhlasíte/);
  assert.equal(kutakovaSessionService.get(callSid).step, 'consent');
});

test('Kutakova bot umozni celu predregistraciu v anglictine', async () => {
  const callSid = 'CA-KUTAKOVA-ENGLISH-00000000000001';
  const start = await incoming(callSid);
  assert.match(start.body, /For English/);

  assert.match((await answer(callSid, 'English')).body, /Do you agree/);
  assert.match((await answer(callSid, 'yes')).body, /first name and surname/);
  assert.match((await answer(callSid, 'John Smith')).body, /full date of birth/);
  assert.match((await answer(callSid, 'April 12th 1985')).body, /health insurance company/);
  assert.match((await answer(callSid, 'Union')).body, /town or municipality/);
  assert.match((await answer(callSid, 'Bratislava')).body, /Is this information correct/);

  const completed = await answer(callSid, 'yes');
  assert.match(completed.body, /securely recorded your pre-registration request/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].patient.birthDate, '1985-04-12');
  assert.match(sentEvents[0].request.detail, /Jazyk hovoru: EN/);
});
