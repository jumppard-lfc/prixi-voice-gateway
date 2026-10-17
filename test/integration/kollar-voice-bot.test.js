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

async function incoming(callSid) {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910922076',
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/kollar/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test.before(async () => {
  prixiService.getConfig = async phone => {
    assert.equal(phone, '+420910922076');
    return { clinicId: '155', voiceBotEnabled: true, timezone: 'Europe/Bratislava' };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  sttService.transcribeAudioUrl = async () => 'Prosím, zavolajte mi ohľadom môjho vyšetrenia.';
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  sttService.transcribeAudioUrl = originalTranscribeAudioUrl;
  await app.close();
});

test('produkčný DID spustí speech-first flow MUDr. Kollára so schváleným úvodom', async () => {
  const response = await incoming('CA-KOLLAR-ROUTE-000000000000000001');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Prepáčte za zdržanie, tu je virtuálna sestra PriXi od pána doktora Kollára/);
  assert.match(response.body, /Stručne povedzte, čo potrebujete/);
  assert.doesNotMatch(response.body, /život ohrozujúci stav|155 alebo 112/);
  assert.match(response.body, /input="speech dtmf"/);
  assert.match(response.body, /action="\/voice\/kollar\/answer"/);
  assert.match(response.body, /akútny problém/);
  assert.doesNotMatch(response.body, /Elissea|Vadkerti/);
});

test('nepochopená odpoveď ponúkne číselný fallback jedna až sedem', async () => {
  const callSid = 'CA-KOLLAR-FALLBACK-000000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'nerozumiem ani ja');

  assert.match(response.body, /Pre akútny problém stlačte jednotku/);
  assert.match(response.body, /Pre ordinačné hodiny šestku/);
  assert.match(response.body, /stlačte sedmičku/);
});

test('akútny problém použije schválenú otázku a vytvorí požiadavku kliniky 155', async () => {
  const callSid = 'CA-KOLLAR-ACUTE-000000000000000001';
  await incoming(callSid);
  const prompt = await answer(callSid, '1', true);
  assert.match(prompt.body, /Povedzte, prosím v jednej vete váš akútny problém/);

  const completion = await answer(callSid, 'Mám silné bolesti v podbrušku');
  await flushPromises();

  assert.match(completion.body, /Vašu požiadavku sme zaznamenali/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '155');
  assert.equal(sentEvents[0].routingPhoneNumber, '+420910922076');
  assert.match(sentEvents[0].problemTranscript, /Kategória: akútny problém/);
  assert.match(sentEvents[0].problemTranscript, /Mám silné bolesti v podbrušku/);
});

test('recept žiada názov lieku a počet balení', async () => {
  const callSid = 'CA-KOLLAR-PRESCRIPTION-000000000001';
  await incoming(callSid);
  const prompt = await answer(callSid, 'potrebujem predpísať lieky');
  assert.match(prompt.body, /Aké lieky si prajete predpísať/);
  assert.match(prompt.body, /názov lieku a počet balení/);

  await answer(callSid, 'Duphaston, dve balenia');
  await flushPromises();

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Kategória: žiadosť o recept/);
  assert.match(sentEvents[0].problemTranscript, /Duphaston, dve balenia/);
});

test('výsledok vyšetrenia vytvorí callback požiadavku', async () => {
  const callSid = 'CA-KOLLAR-RESULTS-00000000000000001';
  await incoming(callSid);
  const completion = await answer(callSid, 'výsledky cytológie');
  await flushPromises();

  assert.match(completion.body, /Ozveme sa vám čo najskôr/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Kategória: výsledok vyšetrenia/);
});

test('objednanie oznámi callback a prípravu dátumu poslednej menštruácie', async () => {
  const callSid = 'CA-KOLLAR-APPOINTMENT-0000000000001';
  await incoming(callSid);
  const completion = await answer(callSid, '4', true);
  await flushPromises();

  assert.match(completion.body, /ozve čo najskôr pre dohodnutie termínu/);
  assert.match(completion.body, /pripravte si dátum poslednej menštruácie/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Kategória: žiadosť o objednanie/);
});

test('nová pacientka dostane webový postup bez SMS alebo PriXi požiadavky', async () => {
  const callSid = 'CA-KOLLAR-NEW-PATIENT-000000000001';
  await incoming(callSid);
  const completion = await answer(callSid, 'chcem byť nová pacientka');
  await flushPromises();

  assert.match(completion.body, /www\.prvazenska\.sk/);
  assert.match(completion.body, /Preniesť kartu/);
  assert.doesNotMatch(completion.body, /SMS/i);
  assert.equal(sentEvents.length, 0);
});

test('ordinačné hodiny obsahujú celý týždeň a utorkovú tehotenskú poradňu', async () => {
  const callSid = 'CA-KOLLAR-HOURS-0000000000000000001';
  await incoming(callSid);
  const completion = await answer(callSid, '6', true);

  assert.match(completion.body, /pondelok od 9\. do 17/);
  assert.match(completion.body, /Utorok je prednostne tehotenská poradňa/);
  assert.match(completion.body, /V piatok neordinujeme/);
  assert.equal(sentEvents.length, 0);
});

test('voľba človeka nahrá odkaz s tónom, prepíše ho a odošle do PriXi', async () => {
  const callSid = 'CA-KOLLAR-HUMAN-000000000000000001';
  await incoming(callSid);
  const prompt = await answer(callSid, 'chcem sa rozprávať s človekom');

  assert.match(prompt.body, /Samozrejme rozumiem/);
  assert.match(prompt.body, /Po zaznení tónu zanechajte prosím krátky odkaz/);
  assert.match(prompt.body, /<Record[^>]+action="\/voice\/kollar\/message"/);
  assert.match(prompt.body, /playBeep="true"/);

  const completion = await post('/voice/kollar/message', {
    CallSid: callSid,
    From: '+421905111222',
    RecordingUrl: 'https://api.twilio.test/recordings/kollar-message',
    RecordingDuration: '12',
  });
  await flushPromises();

  assert.match(completion.body, /Váš odkaz sme zaznamenali/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].problemUrl, 'https://api.twilio.test/recordings/kollar-message');
  assert.equal(sentEvents[0].durationSeconds, 12);
  assert.match(sentEvents[0].problemTranscript, /Prosím, zavolajte mi ohľadom môjho vyšetrenia/);
});

test('pri chybe prepisu sa zachová pôvodná hlasová nahrávka', async () => {
  const callSid = 'CA-KOLLAR-HUMAN-STT-FAIL-00000000001';
  const validTranscribe = sttService.transcribeAudioUrl;
  sttService.transcribeAudioUrl = async () => { throw new Error('test STT failure'); };
  try {
    await incoming(callSid);
    await answer(callSid, '7', true);
    await post('/voice/kollar/message', {
      CallSid: callSid,
      From: '+421905111222',
      RecordingUrl: 'https://api.twilio.test/recordings/kollar-message-fallback',
      RecordingDuration: '9',
    });
    await flushPromises();

    assert.equal(sentEvents.length, 1);
    assert.equal(sentEvents[0].problemUrl, 'https://api.twilio.test/recordings/kollar-message-fallback');
    assert.match(sentEvents[0].problemTranscript, /Hlasový odkaz je priložený bez prepisu/);
  } finally {
    sttService.transcribeAudioUrl = validTranscribe;
  }
});

test('nesprávny clinicId zastaví flow bez zápisu požiadavky', async () => {
  const validGetConfig = prixiService.getConfig;
  prixiService.getConfig = async () => ({ clinicId: '999', voiceBotEnabled: true, timezone: 'Europe/Bratislava' });
  try {
    const response = await incoming('CA-KOLLAR-WRONG-CLINIC-000000000001');
    assert.match(response.body, /Momentálne máme technické problémy/);
    assert.doesNotMatch(response.body, /\/voice\/kollar\/answer/);
    assert.equal(sentEvents.length, 0);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});
