const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const { Settings } = require('luxon');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');
const { prixiVoiceSmsService } = require('../../src/services/prixi-voice-sms.service');

const originalGetVoiceAssistantConfig = prixiService.getVoiceAssistantConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalSendSms = prixiVoiceSmsService.send.bind(prixiVoiceSmsService);
const originalNow = Settings.now;
let sentEvents = [];
let sentSms = [];
let configuredClinicId = '171';

const workingHours = {
  monday: { enabled: true, from: '07:30', to: '12:00' },
  tuesday: { enabled: true, from: '13:00', to: '16:00' },
  wednesday: { enabled: true, from: '07:30', to: '12:00' },
  thursday: { enabled: true, from: '07:30', to: '12:00' },
  friday: { enabled: true, from: '07:30', to: '12:00' },
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

async function incoming(callSid) {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910927214',
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/stefancik/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

test.before(async () => {
  prixiService.getVoiceAssistantConfig = async phone => {
    assert.equal(phone, '+420910927214');
    return {
      clinicId: configuredClinicId,
      assistantType: 'stefancik',
      enabled: true,
      voiceBotEnabled: true,
      timezone: 'Europe/Bratislava',
      availability: { status: 'open' },
      workingHours,
      healthcareProviderId: 200,
    };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  prixiVoiceSmsService.send = async input => {
    sentSms.push(input);
    return { status: 'sent', smsLogId: 22 };
  };
  Settings.now = () => Date.parse('2026-11-23T08:00:00+01:00');
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  sentSms = [];
  configuredClinicId = '171';
});

test.after(async () => {
  Settings.now = originalNow;
  prixiService.getVoiceAssistantConfig = originalGetVoiceAssistantConfig;
  prixiService.sendEvent = originalSendEvent;
  prixiVoiceSmsService.send = originalSendSms;
  await app.close();
});

test('spoločný produkčný webhook routuje DID MUDr. Štefančíka do jeho štvorvetvového flow', async () => {
  const response = await incoming('CA-STEFANCIK-MENU-1');
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /virtuálna sestra PriXi/);
  assert.match(response.body, /objednanie, výsledky, recept alebo ordinačné hodiny/);
  assert.match(response.body, /action="\/voice\/stefancik\/answer"/);
});

test('DID nespustí flow pri inom clinicId', async () => {
  configuredClinicId = '999';
  const response = await incoming('CA-STEFANCIK-WRONG-CLINIC-1');
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /technický problém/);
  assert.doesNotMatch(response.body, /Ako vám môžem pomôcť/);
});

test('termín odošle do eČakárne cez SMS a uloží informačnú požiadavku', async () => {
  await incoming('CA-STEFANCIK-APPOINTMENT-1');
  const response = await answer('CA-STEFANCIK-APPOINTMENT-1', 'chcem termín');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(response.body, /eČakáreň/);
  assert.match(response.body, /SMS správe/);
  assert.equal(sentSms.length, 1);
  assert.match(sentSms[0].message, /ecakaren\.sk\/lekari\/jan-stefancik/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /A\) Žiadosť o termín/);
});

test('v rannom okne prijme konkrétny odkaz o liekoch', async () => {
  await incoming('CA-STEFANCIK-RX-1');
  const prompt = await answer('CA-STEFANCIK-RX-1', 'potrebujem recept');
  assert.match(prompt.body, /meno a priezvisko pacienta, názov lieku/);
  const completion = await answer('CA-STEFANCIK-RX-1', 'Ján Novák, Tamsulosin nula celá štyri miligramu, dve balenia');
  assert.match(completion.body, /požiadavku na lieky som zaznamenala/);
  assert.match(sentEvents[0].problemTranscript, /Tamsulosin/);
});

test('mimo ranného okna liekový odkaz neprijme, ale výsledky správne odkáže', async () => {
  Settings.now = () => Date.parse('2026-11-23T18:00:00+01:00');
  await incoming('CA-STEFANCIK-RX-CLOSED-1');
  const prescription = await answer('CA-STEFANCIK-RX-CLOSED-1', 'recept');
  assert.match(prescription.body, /mimo času na prijímanie požiadaviek/);
  assert.doesNotMatch(prescription.body, /meno a priezvisko pacienta/);

  await incoming('CA-STEFANCIK-RESULTS-CLOSED-1');
  const results = await answer('CA-STEFANCIK-RESULTS-CLOSED-1', 'výsledky');
  assert.match(results.body, /už teraz neordinuje/);
  assert.match(results.body, /medzi desiatou tridsať a dvanástou/);
  assert.equal(sentEvents.length, 0);
  Settings.now = () => Date.parse('2026-11-23T08:00:00+01:00');
});
