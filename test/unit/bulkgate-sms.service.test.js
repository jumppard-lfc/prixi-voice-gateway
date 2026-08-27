const test = require('node:test');
const assert = require('node:assert/strict');

const { BulkGateSmsService } = require('../../src/services/bulkgate-sms.service');

const originalEnv = {
  applicationId: process.env.BULKGATE_APPLICATION_ID,
  applicationToken: process.env.BULKGATE_APPLICATION_TOKEN,
  sender: process.env.BULKGATE_SMS_SENDER,
};

test.beforeEach(() => {
  process.env.BULKGATE_APPLICATION_ID = '38951';
  process.env.BULKGATE_APPLICATION_TOKEN = 'test-token';
  process.env.BULKGATE_SMS_SENDER = 'Klostermann';
});

test.after(() => {
  if (originalEnv.applicationId === undefined) delete process.env.BULKGATE_APPLICATION_ID;
  else process.env.BULKGATE_APPLICATION_ID = originalEnv.applicationId;
  if (originalEnv.applicationToken === undefined) delete process.env.BULKGATE_APPLICATION_TOKEN;
  else process.env.BULKGATE_APPLICATION_TOKEN = originalEnv.applicationToken;
  if (originalEnv.sender === undefined) delete process.env.BULKGATE_SMS_SENDER;
  else process.env.BULKGATE_SMS_SENDER = originalEnv.sender;
});

test('odosle Unicode SMS cez BulkGate Transactional API v2', async () => {
  let capturedRequest;
  const service = new BulkGateSmsService({
    post: async (url, data, config) => {
      capturedRequest = { url, data, config };
      return {
        data: {
          data: {
            response: [{
              status: 'accepted',
              message_id: 'transactional-test-1',
              number: '421900123456',
            }],
          },
        },
      };
    },
  });

  const result = await service.sendTransactionalSms('+421 900 123 456', 'Dobrý deň');

  assert.deepEqual(result, { messageId: 'transactional-test-1', status: 'accepted' });
  assert.equal(capturedRequest.url, 'https://portal.bulkgate.com/api/2.0/advanced/transactional');
  assert.equal(capturedRequest.data.application_id, '38951');
  assert.equal(capturedRequest.data.application_token, 'test-token');
  assert.equal(capturedRequest.data.number, '421900123456');
  assert.equal(capturedRequest.data.text, 'Dobrý deň');
  assert.equal(capturedRequest.data.duplicates_check, 'on');
  assert.deepEqual(capturedRequest.data.channel.sms, {
    sender_id: 'gText',
    sender_id_value: 'Klostermann',
    unicode: true,
  });
  assert.equal(capturedRequest.config.timeout, 10_000);
});

test('odmietne odoslanie bez BulkGate pristupov', async () => {
  delete process.env.BULKGATE_APPLICATION_ID;
  delete process.env.BULKGATE_APPLICATION_TOKEN;
  const service = new BulkGateSmsService({ post: async () => assert.fail('HTTP request must not run') });

  await assert.rejects(
    service.sendTransactionalSms('+421900123456', 'Test'),
    /credentials are not configured/
  );
});

test('chybu BulkGate odpovede nevyhodnoti ako uspesne odoslanie', async () => {
  const service = new BulkGateSmsService({
    post: async () => ({
      data: {
        data: {
          response: [{ status: 'invalid_sender' }],
        },
      },
    }),
  });

  await assert.rejects(
    service.sendTransactionalSms('+421900123456', 'Test'),
    /BulkGate rejected SMS: invalid_sender/
  );
});
