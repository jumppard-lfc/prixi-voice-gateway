const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const twilio = require('twilio');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');
const { prixiCalendarService } = require('../../src/services/prixi-calendar.service');
const { nimalaAudioFiles, nimalaAudioFileNames } = require('../../src/config/nimala-audio.config');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalListServices = prixiCalendarService.listServices.bind(prixiCalendarService);
const originalGetAvailableSlots = prixiCalendarService.getAvailableSlots.bind(prixiCalendarService);
const originalCreateBooking = prixiCalendarService.createBooking.bind(prixiCalendarService);
let sentEvents = [];
let bookingInputs = [];

function assertStaticResponse(response, audioKey, fallbackPattern) {
  const fileName = nimalaAudioFiles[audioKey];
  const filePath = resolve(__dirname, '../../src/assets/audio', fileName);
  if (existsSync(filePath)) {
    assert.match(response.body, new RegExp(`<Play>[^<]*/media/${fileName}</Play>`));
  } else {
    assert.match(response.body, fallbackPattern);
  }
}

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

async function incoming(callSid, overrides = {}) {
  return post('/voice/incoming', {
    CallSid: callSid,
    From: '+421905111222',
    To: '+420910921238',
    ...overrides,
  });
}

async function answer(callSid, value, digits = false) {
  return post('/voice/nimala/answer', {
    CallSid: callSid,
    From: '+421905111222',
    [digits ? 'Digits' : 'SpeechResult']: value,
  });
}

const services = [{
  eventTypeUid: 'preventive-exam',
  name: 'Preventívna prehliadka (30 min.)',
  calendars: [{ calendarId: 7, calendarName: 'MUDr. Dávid Anovčin', eventTypeId: 21, durationMinutes: 30 }],
}];

const slots = [
  { startAt: '2026-11-16T09:00:00+01:00', calendarId: 7, calendarName: 'MUDr. Dávid Anovčin', durationMinutes: 30 },
  { startAt: '2026-11-17T10:30:00+01:00', calendarId: 7, calendarName: 'MUDr. Dávid Anovčin', durationMinutes: 30 },
  { startAt: '2026-11-18T13:00:00+01:00', calendarId: 7, calendarName: 'MUDr. Dávid Anovčin', durationMinutes: 30 },
];

test.before(async () => {
  prixiService.getConfig = async phone => {
    assert.ok(['+420910921238', '+421940621456'].includes(phone));
    return { clinicId: '168', voiceBotEnabled: true, timezone: 'Europe/Bratislava' };
  };
  prixiService.sendEvent = async event => sentEvents.push(event);
  prixiCalendarService.listServices = async () => services;
  prixiCalendarService.getAvailableSlots = async () => slots;
  prixiCalendarService.createBooking = async input => {
    bookingInputs.push(input);
    return { status: 'created', bookingId: 456, startAt: input.startAt };
  };
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  bookingInputs = [];
  delete process.env.NIMALA_HUMAN_TRANSFER_NUMBER;
  prixiCalendarService.listServices = async () => services;
  prixiCalendarService.getAvailableSlots = async () => slots;
  prixiCalendarService.createBooking = async input => {
    bookingInputs.push(input);
    return { status: 'created', bookingId: 456, startAt: input.startAt };
  };
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  prixiCalendarService.listServices = originalListServices;
  prixiCalendarService.getAvailableSlots = originalGetAvailableSlots;
  prixiCalendarService.createBooking = originalCreateBooking;
  delete process.env.NIMALA_HUMAN_TRANSFER_NUMBER;
  await app.close();
});

test('produkčný endpoint routuje autoritatívny Nimala DID aj pri cudzom ForwardedFrom', async () => {
  const response = await incoming('CA-NIMALA-ROUTE-000000000000000001', { ForwardedFrom: '+421902647072' });
  assert.equal(response.statusCode, 200);
  assertStaticResponse(response, 'greeting', /som PriXi, virtuálna asistentka/);
  assert.match(response.body, /<\/(?:Say|Play)><Gather/);
  assert.match(response.body, /action="\/voice\/nimala\/answer"/);
  assert.doesNotMatch(response.body, /Vadkerti/);
});

test('všetky statické Nimala nahrávky majú stabilný názov ako pri Dentbody', () => {
  assert.equal(nimalaAudioFileNames.length, 27);
  nimalaAudioFileNames.forEach((fileName, index) => {
    assert.match(fileName, new RegExp(`^nimala-${String(index + 1).padStart(2, '0')}-[a-z0-9-]+-v1\\.wav$`));
  });
});

test('všetkých 27 Nimala WAV súborov je dostupných pre Twilio', async () => {
  for (const fileName of nimalaAudioFileNames) {
    const response = await app.inject({ method: 'GET', url: `/media/${fileName}` });
    assert.equal(response.statusCode, 200, fileName);
    assert.match(response.headers['content-type'], /^audio\/wav/);
    assert.ok(Number(response.headers['content-length']) > 0, fileName);
  }
});

test('volanie presmerované z čísla kliniky tiež spustí Nimala flow', async () => {
  const response = await incoming('CA-NIMALA-FORWARDED-0000000000001', {
    To: '+420910929999',
    ForwardedFrom: '+421940621456',
  });
  assert.equal(response.statusCode, 200);
  assertStaticResponse(response, 'greeting', /kliniky Nimala/);
});

test('nesprávny clinicId zastaví Nimala flow pred spracovaním údajov pacienta', async () => {
  const validGetConfig = prixiService.getConfig;
  prixiService.getConfig = async () => ({ clinicId: '999', voiceBotEnabled: true, timezone: 'Europe/Bratislava' });
  try {
    const response = await incoming('CA-NIMALA-WRONG-CLINIC-00000000001');
    assertStaticResponse(response, 'startupTechnical', /Momentálne máme technické problémy/);
    assert.doesNotMatch(response.body, /\/voice\/nimala\/answer/);
    assert.equal(sentEvents.length, 0);
  } finally {
    prixiService.getConfig = validGetConfig;
  }
});

test('preventívna prehliadka sa rezervuje iba po výbere a výslovnom potvrdení', async () => {
  const callSid = 'CA-NIMALA-BOOKING-00000000000000001';
  await incoming(callSid);
  const offer = await answer(callSid, 'Chcem preventívnu prehliadku na urológii');
  assert.match(offer.body, /Ďakujem\. Mám pre vás tieto voľné termíny/);
  assert.match(offer.body, /voice="Google\.sk-SK-Wavenet-B"/);
  assert.doesNotMatch(offer.body, /<Play>/);
  assert.match(offer.body, /Možnosť 1/);
  assert.match(offer.body, /16\. novembra/);
  await answer(callSid, 'dva');
  const confirmation = await answer(callSid, 'Ján Novák');
  assert.match(confirmation.body, /Ďakujem\. Prosím, potvrďte rezerváciu/);
  assert.match(confirmation.body, /voice="Google\.sk-SK-Wavenet-B"/);
  assert.doesNotMatch(confirmation.body, /<Play>/);
  assert.match(confirmation.body, /v trvaní 30 minút/);
  assert.match(confirmation.body, /MUDr\. Dávid Anovčin/);
  assert.equal(bookingInputs.length, 0);
  const completed = await answer(callSid, 'áno');

  assert.match(completed.body, /úspešne rezervovaný/);
  assert.match(completed.body, /prajem vám ešte príjemný zvyšok dňa/);
  assert.match(completed.body, /voice="Google\.sk-SK-Wavenet-B"/);
  assert.doesNotMatch(completed.body, /<Play>/);
  assert.equal(bookingInputs.length, 1);
  assert.equal(bookingInputs[0].clinicId, 168);
  assert.equal(bookingInputs[0].calendarId, 7);
  assert.equal(bookingInputs[0].eventTypeUid, 'preventive-exam');
  assert.equal(bookingInputs[0].startAt, '2026-11-17T10:30:00+01:00');
  assert.deepEqual(bookingInputs[0].patient, { name: 'Ján', surname: 'Novák', phone_number: '+421905111222' });
  assert.equal(bookingInputs[0].metadata.externalReference, callSid);
  assert.match(bookingInputs[0].idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.equal(sentEvents.length, 0);
});

test('e-recept zachytí identitu, rok narodenia a liek do PriXi požiadavky', async () => {
  const callSid = 'CA-NIMALA-PRESCRIPTION-000000000001';
  await incoming(callSid);
  await answer(callSid, 'Potrebujem e-recept z urológie');
  await answer(callSid, 'Eva Horváthová');
  await answer(callSid, '1984');
  const completed = await answer(callSid, 'Omnic 0,4 miligramu, dve balenia');
  await new Promise(resolve => setImmediate(resolve));

  assertStaticResponse(completed, 'prescriptionComplete', /Požiadavku na e-recept sme zaznamenali/);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].clinicId, '168');
  assert.equal(sentEvents[0].routingPhoneNumber, '+421940621456');
  assert.equal(sentEvents[0].nameTranscript, 'Eva Horváthová');
  assert.equal(sentEvents[0].birthYearTranscript, '1984');
  assert.match(sentEvents[0].problemTranscript, /Omnic 0,4 miligramu, dve balenia/);
});

test('iná ambulancia oznámi obmedzenie dema bez falošnej požiadavky pod urológiu', async () => {
  const callSid = 'CA-NIMALA-OTHER-DEPARTMENT-0000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'potrebujem dermatológiu');
  await new Promise(resolve => setImmediate(resolve));

  assertStaticResponse(response, 'dermatologyUnavailable', /Vybrali ste odbor dermatológia/);
  assert.equal(sentEvents.length, 0);
  assert.equal(bookingInputs.length, 0);
});

test('otvorená úvodná otázka rozlíši samotnú urológiu aj výsledky vyšetrenia', async () => {
  const urologyCallSid = 'CA-NIMALA-NATURAL-UROLOGY-000000001';
  await incoming(urologyCallSid);
  const urologyMenu = await answer(urologyCallSid, 'Volám na urológiu');
  assertStaticResponse(urologyMenu, 'urologyMenu', /Rozumiem, ide o urológiu/);

  const resultsCallSid = 'CA-NIMALA-NATURAL-RESULTS-0000000001';
  await incoming(resultsCallSid);
  const namePrompt = await answer(resultsCallSid, 'Volám kvôli výsledkom urologického vyšetrenia');
  assertStaticResponse(namePrompt, 'askName', /svoje meno a priezvisko/);
  assert.doesNotMatch(namePrompt.body, /Vyberte si typ vyšetrenia|nimala-03-appointment-type-v1\.wav/);
});

test('po dvoch nerozpoznaných odpovediach prepojí iba na oddelené bezpečné číslo', async () => {
  process.env.NIMALA_HUMAN_TRANSFER_NUMBER = '+421900123456';
  const callSid = 'CA-NIMALA-HANDOFF-0000000000000001';
  await incoming(callSid);
  const retry = await answer(callSid, 'nerozumiem ničomu');
  assert.doesNotMatch(retry.body, /<Dial/);
  const handoff = await answer(callSid, 'stále niečo iné');

  assert.match(handoff.body, /<Dial/);
  assert.match(handoff.body, /\+421900123456/);
  assert.doesNotMatch(handoff.body, /\+421940621456<\/Number>/);
});

test('hlavné číslo kliniky sa ako transfer cieľ odmietne, aby nevznikla slučka', async () => {
  process.env.NIMALA_HUMAN_TRANSFER_NUMBER = '+421940621456';
  const callSid = 'CA-NIMALA-LOOP-GUARD-0000000000001';
  await incoming(callSid);
  const fallback = await answer(callSid, 'Chcem hovoriť s človekom');
  await new Promise(resolve => setImmediate(resolve));

  assert.doesNotMatch(fallback.body, /<Dial/);
  assertStaticResponse(fallback, 'transferUnavailable', /žiadosť o telefonický kontakt/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /spojenie s človekom/);
});

test('timeout rezervácie zopakuje identický payload a kľúč a potom nevyrobí duplikát', async () => {
  prixiCalendarService.createBooking = async input => {
    bookingInputs.push(input);
    return { status: 'uncertain', message: 'timeout' };
  };
  const callSid = 'CA-NIMALA-TIMEOUT-0000000000000001';
  await incoming(callSid);
  await answer(callSid, 'Chcem preventívnu prehliadku na urológii');
  await answer(callSid, 'dva');
  await answer(callSid, 'Ján Novák');
  const response = await answer(callSid, 'áno');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(bookingInputs.length, 2);
  assert.deepEqual(bookingInputs[1], bookingInputs[0]);
  assertStaticResponse(response, 'bookingStatusUncertain', /nevznikla duplicitná rezervácia/);
  assert.equal(sentEvents.length, 1);
});

