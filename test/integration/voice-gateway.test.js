const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const { execSync } = require('node:child_process');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

const appModule = require('../../src/app');
const serviceModule = require('../../src/services/prixi.service');

const app = appModule.default;
const prixiService = serviceModule.prixiService;
const projectRoot = path.join(__dirname, '../..');

const originalGetConfig = prixiService.getConfig.bind(prixiService);

function buildSignature(url, params) {
  return twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
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

test('POST /voice/booking/start zacne hlasovy booking flow', async () => {
  const endpoint = '/voice/booking/start';
  const params = { From: '+421900000001', CallSid: 'CA99999999999999999999999999999999' };
  const signature = buildSignature(`https://127.0.0.1:3000${endpoint}`, params);
  const response = await app.inject({
    method: 'POST', url: endpoint,
    headers: { 'content-type': 'application/x-www-form-urlencoded', host: '127.0.0.1:3000', 'x-forwarded-proto': 'https', 'x-twilio-signature': signature },
    payload: 'From=%2B421900000001&CallSid=CA99999999999999999999999999999999',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Gather/);
  assert.match(response.body, /Aké vyšetrenie potrebujete/);
});
