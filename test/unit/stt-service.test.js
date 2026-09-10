const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

const { getAudioFileExtension } = require('../../src/services/stt.service');

test('docasny audio subor zachova format vyziadany z Twilia', () => {
  assert.equal(
    getAudioFileExtension('https://api.twilio.test/Recordings/RE123.mp3'),
    '.mp3'
  );
  assert.equal(
    getAudioFileExtension('https://api.twilio.test/Recordings/RE123.wav?download=1'),
    '.wav'
  );
});

test('Twilio URL bez znamej pripony pouzije MP3 fallback', () => {
  assert.equal(
    getAudioFileExtension('https://api.twilio.test/Recordings/RE123'),
    '.mp3'
  );
});
