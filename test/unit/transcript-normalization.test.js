const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBirthYearTranscript } = require('../../src/utils/transcript-normalization');

test('rok narodenia prijme styri cislice aj s medzerami a interpunkciou', () => {
  assert.equal(normalizeBirthYearTranscript('1 9 5 1.', 2026), '1951');
});

test('rok narodenia odmietne text, URL a neplatny rozsah', () => {
  assert.equal(normalizeBirthYearTranscript('Číslo je 1951.', 2026), '');
  assert.equal(normalizeBirthYearTranscript('www.hradeckralove.com', 2026), '');
  assert.equal(normalizeBirthYearTranscript('3025', 2026), '');
});
