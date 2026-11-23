const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { neurocentrumEdsService } = require('../../src/services/neurocentrum-eds.service');
const { kutakovaSessionService } = require('../../src/services/kutakova-session.service');

const originalSendPatientRequest = neurocentrumEdsService.sendPatientRequest.bind(neurocentrumEdsService);
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
  kutakovaSessionService.resetForTests();
  neurocentrumEdsService.sendPatientRequest = async event => {
    sentEvents.push(event);
    return 'created';
  };
});

test.after(async () => {
  neurocentrumEdsService.sendPatientRequest = originalSendPatientRequest;
  await app.close();
});

test('Kutakova bot vytvori potvrdenu predregistraciu pre clinic 158 cez EDS', async () => {
  const callSid = 'CA-KUTAKOVA-PREREG-00000000000001';
  const start = await incoming(callSid);
  assert.equal(start.statusCode, 200);
  assert.match(start.body, /predregistráciu/);
  assert.match(start.body, /nie je potvrdenou registráciou ani objednaním/);
  assert.match(start.body, /zaznamenali údaje/);

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
  assert.match(completed.body, /žiadosť o predregistráciu sme bezpečne zaznamenali/);
  assert.match(completed.body, /Nejde ešte o potvrdenú registráciu/);
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
      existingPatient: true,
      firstName: 'Jana',
      lastName: 'Nováková',
      birthDate: '1985-04-12',
    },
    request: {
      type: 'follow_up',
      detail: [
        'PREDREGISTRÁCIA NOVÉHO PACIENTA pred otvorením ambulancie.',
        'Nejde o potvrdenú registráciu ani objednanie na vyšetrenie.',
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
  await answer(callSid, 'áno');
  await answer(callSid, 'Jana Nováková');
  await answer(callSid, '12. 4. 1985');
  await answer(callSid, 'Dôvera');
  await answer(callSid, 'Bratislava');
  const response = await answer(callSid, 'áno');

  assert.match(response.body, /nepodarilo vašu predregistráciu bezpečne uložiť/);
  assert.doesNotMatch(response.body, /bezpečne zaznamenali/);
});
