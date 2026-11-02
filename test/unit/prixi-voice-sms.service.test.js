const test = require('node:test');
const assert = require('node:assert/strict');

const { PrixiVoiceSmsService } = require('../../src/services/prixi-voice-sms.service');

const originalEnv = {
  apiUrl: process.env.PRIXI_API_URL,
  smsApiUrl: process.env.PRIXI_VOICE_SMS_API_URL,
  gatewayToken: process.env.PRIXI_VOICE_GATEWAY_TOKEN,
  apiKey: process.env.PRIXI_API_KEY,
};

test.beforeEach(() => {
  process.env.PRIXI_API_URL = 'https://prixi.test';
  delete process.env.PRIXI_VOICE_SMS_API_URL;
  process.env.PRIXI_VOICE_GATEWAY_TOKEN = 'voice-gateway-test-token';
  delete process.env.PRIXI_API_KEY;
});

test.after(() => {
  for (const [name, value] of Object.entries({
    PRIXI_API_URL: originalEnv.apiUrl,
    PRIXI_VOICE_SMS_API_URL: originalEnv.smsApiUrl,
    PRIXI_VOICE_GATEWAY_TOKEN: originalEnv.gatewayToken,
    PRIXI_API_KEY: originalEnv.apiKey,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('odosle Klostermann SMS cez PriXi Voice SMS API', async () => {
  let capturedRequest;
  const service = new PrixiVoiceSmsService({
    post: async (url, data, config) => {
      capturedRequest = { url, data, config };
      return {
        status: 200,
        data: { success: true, sms_log_id: 456, status: 'sent' },
      };
    },
  });

  const result = await service.send({
    healthcareProviderId: 123,
    phoneNumber: '+421 900 123 456',
    message: 'Objednajte sa na klostermann.sk/rezervacia',
    idempotencyKey: 'call-CA123-sms-klostermann-booking-link',
  });

  assert.deepEqual(result, { smsLogId: 456, status: 'sent' });
  assert.equal(capturedRequest.url, 'https://prixi.test/api/voice/sms/send');
  assert.deepEqual(capturedRequest.data, {
    healthcare_provider_id: 123,
    phone_number: '+421900123456',
    message: 'Objednajte sa na klostermann.sk/rezervacia',
    idempotency_key: 'call-CA123-sms-klostermann-booking-link',
  });
  assert.equal(capturedRequest.config.headers.Authorization, 'Bearer voice-gateway-test-token');
  assert.equal(capturedRequest.config.timeout, 10_000);
});

test('pri opakovani pouzije ten isty dodany idempotency key', async () => {
  const requests = [];
  const service = new PrixiVoiceSmsService({
    post: async (_url, data) => {
      requests.push(data);
      return { data: { success: true, sms_log_id: 456, status: 'sent' } };
    },
  });
  const input = {
    healthcareProviderId: 123,
    phoneNumber: '+421900123456',
    message: 'Test',
    idempotencyKey: 'call-CA123-sms-klostermann-booking-link',
  };

  await service.send(input);
  await service.send(input);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotency_key, requests[1].idempotency_key);
});

test('akceptuje pending bez vytvorenia automatickeho retry', async () => {
  const service = new PrixiVoiceSmsService({
    post: async () => ({ data: { success: true, sms_log_id: 789, status: 'pending' } }),
  });

  const result = await service.send({
    healthcareProviderId: 123,
    phoneNumber: '+421900123456',
    message: 'Test',
    idempotencyKey: 'call-CA456-sms-klostermann-booking-link',
  });

  assert.deepEqual(result, { smsLogId: 789, status: 'pending' });
});

test('odmietne odoslanie bez tokenu alebo provider ID', async () => {
  delete process.env.PRIXI_VOICE_GATEWAY_TOKEN;
  delete process.env.PRIXI_API_KEY;
  const service = new PrixiVoiceSmsService({ post: async () => assert.fail('HTTP request must not run') });

  await assert.rejects(
    service.send({
      healthcareProviderId: 123,
      phoneNumber: '+421900123456',
      message: 'Test',
      idempotencyKey: 'call-CA789-sms-klostermann-booking-link',
    }),
    /token is not configured/
  );

  process.env.PRIXI_VOICE_GATEWAY_TOKEN = 'voice-gateway-test-token';
  await assert.rejects(
    service.send({
      healthcareProviderId: Number.NaN,
      phoneNumber: '+421900123456',
      message: 'Test',
      idempotencyKey: 'call-CA789-sms-klostermann-booking-link',
    }),
    /provider ID is invalid/
  );
});

test('failed odpoved nepovazuje za uspesne odoslanie', async () => {
  const service = new PrixiVoiceSmsService({
    post: async () => ({ data: { success: true, sms_log_id: 999, status: 'failed' } }),
  });

  await assert.rejects(
    service.send({
      healthcareProviderId: 123,
      phoneNumber: '+421900123456',
      message: 'Test',
      idempotencyKey: 'call-CA999-sms-klostermann-booking-link',
    }),
    /rejected the SMS/
  );
});
