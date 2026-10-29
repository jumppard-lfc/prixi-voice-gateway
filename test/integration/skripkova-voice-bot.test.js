const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');
const { sttService } = require('../../src/services/stt.service');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalTranscribeAudioUrl = sttService.transcribeAudioUrl.bind(sttService);

let requestedPhoneNumbers = [];
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

test.before(async () => {
  prixiService.getConfig = async phoneNumber => {
    requestedPhoneNumbers.push(phoneNumber);
    return {
      clinicId: '164',
      voiceBotEnabled: true,
      timezone: 'Europe/Bratislava',
      pediatricMode: true,
    };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  sttService.transcribeAudioUrl = async () => 'Ema Nováková, volám kvôli vysokej horúčke od včera.';
  await app.ready();
});

test.beforeEach(() => {
  requestedPhoneNumbers = [];
  sentEvents = [];
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  sttService.transcribeAudioUrl = originalTranscribeAudioUrl;
  await app.close();
});

test('obe ElevenLabs nahrávky sú dostupné ako Twilio-kompatibilné WAV', async () => {
  const [greeting, completion] = await Promise.all([
    app.inject({ method: 'GET', url: '/media/skripkova-1-greeting-v1.wav' }),
    app.inject({ method: 'GET', url: '/media/skripkova-2-completion-v1.wav' }),
  ]);

  for (const response of [greeting, completion]) {
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /^audio\/wav/);
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.ok(response.rawPayload.length > 60_000);
    assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
  }
});

test('dedikované Twilio číslo spustí krátky jednokrokový flow MUDr. Škripkovej', async () => {
  const response = await post('/voice/incoming', {
    CallSid: 'CA-SKRIPKOVA-INCOMING-000000000001',
    From: '+421905111222',
    To: '+420910929573',
    // Dedicated destination must win over a conflicting carrier header.
    ForwardedFrom: '+421911135193',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requestedPhoneNumbers, ['+421455442237']);
  assert.match(response.body, /<Play>https:\/\/127\.0\.0\.1:3000\/media\/skripkova-1-greeting-v1\.wav<\/Play>/);
  assert.doesNotMatch(response.body, /<Say/);
  assert.match(response.body, /<Record/);
  assert.match(response.body, /timeout="3"/);
  assert.match(response.body, /forwardedFrom=%2B421455442237/);
  assert.match(response.body, /pediatricMode=true/);
  assert.doesNotMatch(response.body, /record-name|recording-complete|rok narodenia/);
});

test('jedna odpoveď uloží audio aj celý prepis do clinic ID 164 a hovor ukončí', async () => {
  const callSid = 'CA-SKRIPKOVA-RECORDING-00000000001';
  await post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910929573',
  });

  const response = await post('/voice/record-problem?forwardedFrom=%2B421455442237&pediatricMode=true&dentalMode=false', {
    CallSid: callSid,
    From: '+421905111222',
    RecordingUrl: 'https://api.twilio.test/skripkova-problem',
    RecordingDuration: '13',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Play>https:\/\/127\.0\.0\.1:3000\/media\/skripkova-2-completion-v1\.wav<\/Play>/);
  assert.doesNotMatch(response.body, /<Say/);
  assert.match(response.body, /<Hangup\/>/);
  assert.doesNotMatch(response.body, /record-name|recording-complete|rok narodenia/);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '164');
  assert.equal(sentEvents[0].routingPhoneNumber, '+421455442237');
  assert.equal(sentEvents[0].phone, '+421905111222');
  assert.equal(sentEvents[0].problemUrl, 'https://api.twilio.test/skripkova-problem');
  assert.equal(sentEvents[0].problemTranscript, 'Ema Nováková, volám kvôli vysokej horúčke od včera.');
  assert.equal(sentEvents[0].nameTranscript, '');
  assert.equal(sentEvents[0].birthYearTranscript, '');
});

test('PriXi fallback konfigurácia pozná obe čísla ambulancie', async () => {
  const twilioConfig = await originalGetConfig('+420910929573');
  const clinicLineConfig = await originalGetConfig('+421455442237');

  assert.equal(twilioConfig.clinicId, '164');
  assert.equal(twilioConfig.pediatricMode, true);
  assert.equal(clinicLineConfig.clinicId, '164');
  assert.equal(clinicLineConfig.voiceBotEnabled, true);
});
