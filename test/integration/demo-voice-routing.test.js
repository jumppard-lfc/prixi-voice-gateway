const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const os = require('node:os');
const { rmSync } = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
process.env.VOICE_BOT_BUILDER_TOKEN = 'demo-routing-builder-token';
process.env.VOICE_BOT_CONFIG_DIR = path.join(os.tmpdir(), `prixi-demo-routing-${process.pid}`);

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');

const configDirectory = process.env.VOICE_BOT_CONFIG_DIR;
const originalGetConfig = prixiService.getConfig.bind(prixiService);

function configFor(id, inboundTwilioNumbers) {
  return {
    version: 1,
    id,
    clinic: { displayName: 'DentCare Bratislava', specialty: 'zubná klinika', locale: 'sk-SK', timezone: 'Europe/Bratislava' },
    provider: { kind: 'bookio', mode: 'demo_mock' },
    routing: { inboundTwilioNumbers },
    services: [{ id: 'hygiene', label: 'Dentálna hygiena', durationMinutes: 45, voiceAliases: ['hygiena'] }],
    conversation: {
      confirmService: true, confirmDatePreference: true, confirmSlot: true, confirmName: false,
      requireTerms: true, sendConfirmationSms: true, useDtmfFallback: true, playPromptTone: true,
    },
    copy: {},
  };
}

function signature(endpoint, params) {
  return twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `https://127.0.0.1:3000${endpoint}`, params);
}

async function signedPost(endpoint, params) {
  return app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': signature(endpoint, params),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

async function save(config) {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/voice-bot-builder/save',
    headers: { authorization: 'Bearer demo-routing-builder-token' },
    payload: config,
  });
  assert.equal(response.statusCode, 200);
}

test.before(async () => {
  await app.ready();
  prixiService.getConfig = async () => ({ clinicId: 'test-clinic', voiceBotEnabled: false, timezone: 'Europe/Bratislava' });
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  rmSync(configDirectory, { recursive: true, force: true });
  await app.close();
});

test('dedikované Twilio číslo spustí iba jemu priradený demo bot', async () => {
  await save(configFor('dentcare-bratislava-demo', ['+420910921168']));
  const params = { From: '+421900000125', To: '+420910921168', CallSid: 'CA90000000000000000000000000000001' };

  const response = await signedPost('/voice/incoming', params);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Redirect>\/voice\/demo\/dentcare-bratislava-demo\/start<\/Redirect>/);
});

test('dynamická URL zostáva nezávisle dostupná pre ten istý demo bot', async () => {
  const params = { From: '+421900000125', CallSid: 'CA90000000000000000000000000000002' };
  const response = await signedPost('/voice/demo/dentcare-bratislava-demo/incoming', params);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Redirect>\/voice\/demo\/dentcare-bratislava-demo\/start<\/Redirect>/);
});

test('konfigurácia nikdy neprevezme chránené produkčné Twilio číslo', async () => {
  await save(configFor('blocked-demo-bot', ['+420910927082']));
  prixiService.getConfig = async () => ({
    clinicId: '142', voiceBotEnabled: false, timezone: 'Europe/Bratislava', pediatricMode: true,
  });

  try {
    const response = await signedPost('/voice/incoming', {
      From: '+421900000125', To: '+420910927082', CallSid: 'CA90000000000000000000000000000003',
    });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body, /blocked-demo-bot/);
    assert.match(response.body, /pediatrickej ambulancie doktorky Čelkovej/);
  } finally {
    prixiService.getConfig = async () => ({ clinicId: 'test-clinic', voiceBotEnabled: false, timezone: 'Europe/Bratislava' });
  }
});
