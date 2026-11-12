const test = require('node:test');
const assert = require('node:assert/strict');
const { ElevenLabsTtsService } = require('../../src/services/elevenlabs-tts.service');

test('ElevenLabs TTS posiela telefónny μ-law formát a nakonfigurovaný hlas', async () => {
  const originalEnv = {
    apiKey: process.env.ELEVENLABS_API_KEY,
  };
  process.env.ELEVENLABS_API_KEY = 'test-key';

  let request;
  const fakeClient = {
    post: async (...args) => {
      request = args;
      return { data: Uint8Array.from([255, 127, 0]).buffer };
    },
  };

  try {
    const service = new ElevenLabsTtsService(fakeClient);
    const audio = await service.synthesizeForPhone('Voľný termín je v piatok o ôsmej.', {
      voiceId: 'slovak-voice',
      modelId: 'eleven_flash_v2_5',
      outputFormat: 'ulaw_8000',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: true,
        speed: 1,
      },
    });

    assert.deepEqual([...audio], [255, 127, 0]);
    assert.equal(request[0], '/v1/text-to-speech/slovak-voice/stream');
    assert.equal(request[1].model_id, 'eleven_flash_v2_5');
    assert.equal(request[1].text, 'Voľný termín je v piatok o ôsmej.');
    assert.equal(request[2].headers['xi-api-key'], 'test-key');
    assert.equal(request[2].params.output_format, 'ulaw_8000');
    assert.equal(request[2].responseType, 'arraybuffer');
  } finally {
    restoreEnv('ELEVENLABS_API_KEY', originalEnv.apiKey);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
