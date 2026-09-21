const test = require('node:test');
const assert = require('node:assert/strict');

const { NeurocentrumEdsService } = require('../../src/services/neurocentrum-eds.service');

function configResponse() {
  return {
    clinicId: 42,
    enabled: true,
    timezone: 'Europe/Bratislava',
    availability: { status: 'open' },
    maxConcurrentCalls: 3,
    messages: {
      greeting: 'Dobrý deň.',
      existingPatientQuestion: 'Ste existujúci pacient?',
      newPatient: 'Prvovyšetrenie osobne.',
      vacation: 'Dovolenka.',
      outsideHours: 'Mimo hodín.',
      busy: 'Obsadené.',
      technicalError: 'Technická chyba.',
      urgent: 'Volajte 155.',
      success: 'Zaznamenané.',
    },
  };
}

test('EDS klient normalizuje konfiguráciu a používa krátku cache', async () => {
  let calls = 0;
  const client = {
    get: async (url, options) => {
      calls += 1;
      assert.equal(url, '/api/voice/config');
      assert.equal(options.params.phoneNumber, '+421948914896');
      return { data: configResponse() };
    },
  };
  const service = new NeurocentrumEdsService(client);
  const first = await service.getConfig('+421948914896');
  const second = await service.getConfig('+421948914896');
  assert.equal(calls, 1);
  assert.equal(first.clinicId, '42');
  assert.equal(first.messages.afterHours, 'Mimo hodín.');
  assert.equal(first.messages.technical, 'Technická chyba.');
  assert.deepEqual(second, first);
});

test('pri krátkom výpadku config API sa použije posledná známa konfigurácia', async () => {
  const previousCacheTtl = process.env.EDS_VOICE_CONFIG_CACHE_TTL_MS;
  process.env.EDS_VOICE_CONFIG_CACHE_TTL_MS = '1';
  let fail = false;
  const client = {
    get: async () => {
      if (fail) throw new Error('network down');
      return { data: configResponse() };
    },
  };
  const service = new NeurocentrumEdsService(client);
  const expected = await service.getConfig('+421948914896');
  fail = true;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(await service.getConfig('+421948914896'), expected);
  if (previousCacheTtl === undefined) delete process.env.EDS_VOICE_CONFIG_CACHE_TTL_MS;
  else process.env.EDS_VOICE_CONFIG_CACHE_TTL_MS = previousCacheTtl;
});

test('patient request event sa opakuje pri 5xx a používa CallSid ako idempotency key', async () => {
  let calls = 0;
  const client = {
    post: async (url, payload, options) => {
      calls += 1;
      assert.equal(url, '/api/voice/event');
      assert.equal(options.headers['Idempotency-Key'], payload.callSid);
      if (calls === 1) throw { isAxiosError: true, response: { status: 503 } };
      return { data: { status: 'success' } };
    },
  };
  const service = new NeurocentrumEdsService(client);
  const result = await service.sendPatientRequest({ callSid: 'CA123' });
  assert.equal(result, 'created');
  assert.equal(calls, 2);
});

test('EDS duplicate odpoveď sa považuje za úspech bez ďalšieho retry', async () => {
  let calls = 0;
  const client = {
    post: async () => {
      calls += 1;
      throw { isAxiosError: true, response: { status: 409, data: { status: 'duplicate' } } };
    },
  };
  const service = new NeurocentrumEdsService(client);
  assert.equal(await service.sendPatientRequest({ callSid: 'CA123' }), 'duplicate');
  assert.equal(calls, 1);
});
