const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const { DateTime, Settings } = require('luxon');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalNow = Settings.now;
const officeHoursTimestamp = DateTime.fromISO('2026-09-16T08:00:00+02:00').toMillis();
const afterHoursTimestamp = DateTime.fromISO('2026-09-16T12:00:00+02:00').toMillis();
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

async function answer(callSid, speech) {
  return post('/voice/vadkerti/answer', { CallSid: callSid, From: '+421905111222', SpeechResult: speech });
}

async function incoming(callSid, from = '+421905111222') {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: from,
    To: '+421900777777',
    ForwardedFrom: '+421902647072',
  });
}

test.before(async () => {
  prixiService.getConfig = async (phone) => {
    assert.equal(phone, '+421902647072');
    return { clinicId: '777', voiceBotEnabled: true, timezone: 'Europe/Bratislava' };
  };
  prixiService.sendEvent = async (event) => sentEvents.push(event);
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  Settings.now = () => officeHoursTimestamp;
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  Settings.now = originalNow;
  await app.close();
});

test('vseobecny produkcny endpoint routuje priamo na oddeleny Vadkerti flow', async () => {
  const response = await post('/voice/incoming', {
    CallSid: 'CA-VADKERTI-ROUTING-000000000000001',
    From: '+421905111222',
    To: '+421900777777',
    ForwardedFrom: '+421902647072',
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /neurologickej ambulancie doktora Petra Vadkertiho/);
  assert.match(response.body, /action="\/voice\/vadkerti\/answer"/);
  assert.doesNotMatch(response.body, /\/voice\/vadkerti\/incoming/);
  assert.doesNotMatch(response.body, /\/voice\/demo\//);
  assert.equal(app.hasRoute({ method: 'POST', url: '/voice/vadkerti/incoming' }), false);
});

test('Vadkerti routing nezapise poziadavku pri nerozpoznanom Prixi clinicId', async () => {
  const validGetConfig = prixiService.getConfig;
  prixiService.getConfig = async () => ({ clinicId: 'fallback', voiceBotEnabled: true, timezone: 'Europe/Bratislava' });
  try {
    const callSid = 'CA-VADKERTI-WRONG-CLINIC-00000000001';
    await incoming(callSid);
    const response = await answer(callSid, 'slovensky');
    assert.match(response.body, /Momentálne máme technické problémy/);
    assert.equal(sentEvents.length, 0);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});

test('slovensky flow noveho pacienta vytvori kategorizovanu poziadavku v PriXi bez terminu', async () => {
  const callSid = 'CA-VADKERTI-SK-00000000000000000001';
  const started = await incoming(callSid);
  assert.match(started.body, /neurologickej ambulancie doktora Petra Vadkertiho/);

  assert.match((await answer(callSid, 'slovensky')).body, /Stručne mi/);
  assert.match((await answer(callSid, 'Chcem sa objednať na neurologické vyšetrenie')).body, /Boli ste už vyšetrený v tejto aktuálnej ambulancii/);
  assert.match((await answer(callSid, 'nie')).body, /iným neurológom/);
  assert.match((await answer(callSid, 'nie')).body, /meno a priezvisko/);
  assert.match((await answer(callSid, 'Ján Novák')).body, /rok narodenia/);
  const completed = await answer(callSid, '1984');
  assert.match(completed.body, /Konkrétny termín sme teraz nerezervovali/);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '777');
  assert.equal(sentEvents[0].routingPhoneNumber, '+421902647072');
  assert.equal(sentEvents[0].nameTranscript, 'Ján Novák');
  assert.equal(sentEvents[0].birthYearTranscript, '1984');
  assert.match(sentEvents[0].problemTranscript, /Kategória: nový pacient \/ ešte nebol u neurológa/);
  assert.match(sentEvents[0].problemTranscript, /Jazyk hovoru: SK/);
  assert.match(sentEvents[0].problemTranscript, /Konkrétny termín nebol pridelený/);
});

test('madarsky flow receptu od pacienta mimo aktualnej ambulancie neslubuje predpis', async () => {
  const callSid = 'CA-VADKERTI-HU-00000000000000000001';
  await incoming(callSid, '+421905111223');
  assert.match((await answer(callSid, 'magyarul')).body, /Kérem, röviden/);
  assert.match((await answer(callSid, 'Gyógyszer receptet kérek')).body, /jelenlegi rendelőjében/);
  assert.match((await answer(callSid, 'nem')).body, /Melyik gyógyszerre/);
  await answer(callSid, 'Tegretol kétszáz milligramm');
  await answer(callSid, 'Kovács Anna');
  const completed = await answer(callSid, '1975');
  assert.match(completed.body, /csak azoknak írhat fel receptet/);
  assert.match(completed.body, /nem jelenti a recept automatikus felírását/);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Jazyk hovoru: HU/);
  assert.match(sentEvents[0].problemTranscript, /NEBOL vyšetrený v aktuálnej ambulancii/);
});

test('urgentny symptom ukonci administrativny flow a odkáže na 155 alebo 112', async () => {
  const callSid = 'CA-VADKERTI-URGENT-0000000000000001';
  await incoming(callSid, '+421905111224');
  await answer(callSid, 'slovensky');
  const response = await answer(callSid, 'Náhle mi ochrnula pravá strana a neviem rozprávať');
  assert.match(response.body, /155 alebo 112/);
  assert.match(response.body, /<Hangup\/>/);
  assert.equal(sentEvents.length, 0);
});

test('po 12:00 bot pouzije lokalizovany after-hours flow a nevytvori poziadavku', async () => {
  Settings.now = () => afterHoursTimestamp;
  const callSid = 'CA-VADKERTI-AFTER-00000000000000001';
  await incoming(callSid, '+421905111225');
  const response = await answer(callSid, 'magyarul');
  assert.match(response.body, /fél nyolctól délig/);
  assert.match(response.body, /következő munkanapon/);
  assert.equal(sentEvents.length, 0);
});
