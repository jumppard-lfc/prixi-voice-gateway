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
const { elevenLabsTtsService } = require('../../src/services/elevenlabs-tts.service');
const { nimalaAudioFiles, nimalaAudioFileNames } = require('../../src/config/nimala-audio.config');

const originalGetConfig = prixiService.getConfig.bind(prixiService);
const originalSendEvent = prixiService.sendEvent.bind(prixiService);
const originalListServices = prixiCalendarService.listServices.bind(prixiCalendarService);
const originalGetAvailableSlots = prixiCalendarService.getAvailableSlots.bind(prixiCalendarService);
const originalCreateBooking = prixiCalendarService.createBooking.bind(prixiCalendarService);
const originalVerifyPatient = prixiCalendarService.verifyPatient.bind(prixiCalendarService);
const originalListPatientBookings = prixiCalendarService.listPatientBookings.bind(prixiCalendarService);
const originalRescheduleBooking = prixiCalendarService.rescheduleBooking.bind(prixiCalendarService);
const originalCancelBooking = prixiCalendarService.cancelBooking.bind(prixiCalendarService);
let sentEvents = [];
let bookingInputs = [];
let verificationInputs = [];
let rescheduleInputs = [];
let cancellationInputs = [];

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

const patientBookings = [{
  id: 456,
  clinicId: 168,
  calendarId: 7,
  calendarName: 'MUDr. Dávid Anovčin',
  eventTypeUid: 'preventive-exam',
  serviceName: 'Preventívna prehliadka',
  startAt: '2026-12-03T09:00:00+01:00',
  endAt: '2026-12-03T09:30:00+01:00',
  durationMinutes: 30,
  status: 'accepted',
}];

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
  prixiCalendarService.verifyPatient = async input => {
    verificationInputs.push(input);
    return { status: 'verified', verificationToken: 'patient-token', expiresIn: 600 };
  };
  prixiCalendarService.listPatientBookings = async () => ({ status: 'ok', bookings: patientBookings });
  prixiCalendarService.rescheduleBooking = async input => {
    rescheduleInputs.push(input);
    return {
      status: 'rescheduled',
      booking: { ...patientBookings[0], calendarId: input.calendarId, startAt: input.startAt },
      emailNotification: 'sent',
    };
  };
  prixiCalendarService.cancelBooking = async input => {
    cancellationInputs.push(input);
    return { status: 'cancelled' };
  };
  await app.ready();
});

test.beforeEach(() => {
  sentEvents = [];
  bookingInputs = [];
  verificationInputs = [];
  rescheduleInputs = [];
  cancellationInputs = [];
  delete process.env.NIMALA_HUMAN_TRANSFER_NUMBER;
  delete process.env.ELEVENLABS_API_KEY;
  prixiCalendarService.listServices = async () => services;
  prixiCalendarService.getAvailableSlots = async () => slots;
  prixiCalendarService.createBooking = async input => {
    bookingInputs.push(input);
    return { status: 'created', bookingId: 456, startAt: input.startAt };
  };
  prixiCalendarService.verifyPatient = async input => {
    verificationInputs.push(input);
    return { status: 'verified', verificationToken: 'patient-token', expiresIn: 600 };
  };
  prixiCalendarService.listPatientBookings = async () => ({ status: 'ok', bookings: patientBookings });
  prixiCalendarService.rescheduleBooking = async input => {
    rescheduleInputs.push(input);
    return {
      status: 'rescheduled',
      booking: { ...patientBookings[0], calendarId: input.calendarId, startAt: input.startAt },
      emailNotification: 'sent',
    };
  };
  prixiCalendarService.cancelBooking = async input => {
    cancellationInputs.push(input);
    return { status: 'cancelled' };
  };
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  prixiService.sendEvent = originalSendEvent;
  prixiCalendarService.listServices = originalListServices;
  prixiCalendarService.getAvailableSlots = originalGetAvailableSlots;
  prixiCalendarService.createBooking = originalCreateBooking;
  prixiCalendarService.verifyPatient = originalVerifyPatient;
  prixiCalendarService.listPatientBookings = originalListPatientBookings;
  prixiCalendarService.rescheduleBooking = originalRescheduleBooking;
  prixiCalendarService.cancelBooking = originalCancelBooking;
  delete process.env.NIMALA_HUMAN_TRANSFER_NUMBER;
  delete process.env.ELEVENLABS_API_KEY;
  await app.close();
});

test('produkčný endpoint routuje autoritatívny Nimala DID aj pri cudzom ForwardedFrom', async () => {
  const response = await incoming('CA-NIMALA-ROUTE-000000000000000001', { ForwardedFrom: '+421902647072' });
  assert.equal(response.statusCode, 200);
  assertStaticResponse(response, 'greeting', /som PriXi, virtuálna asistentka/);
  assert.match(response.body, /<Gather[^>]*>[\s\S]*<(?:Say|Play)>/);
  assert.doesNotMatch(response.body, /<\/(?:Say|Play)><Gather/);
  assert.match(response.body, /action="\/voice\/nimala\/answer"/);
  assert.match(response.body, /bargeIn="true"/);
  assert.match(response.body, /timeout="4"/);
  assert.match(response.body, /speechTimeout="auto"/);
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
  assert.match(offer.body, /Možnosť jedna/);
  assert.match(offer.body, /šestnásteho novembra/);
  assert.match(offer.body, /timeout="4"/);
  assert.match(offer.body, /speechTimeout="auto"/);
  const namePrompt = await answer(callSid, 'dva');
  assert.match(namePrompt.body, /Ďakujem, rozumiem\. Len to ešte pre istotu zhrniem/);
  assert.match(namePrompt.body, /Vybraný typ vyšetrenia je Preventívna prehliadka/);
  assert.match(namePrompt.body, /sedemnásteho novembra, o desiatej tridsať/);
  assert.match(namePrompt.body, /bargeIn="true"/);
  assert.match(namePrompt.body, /timeout="6"/);
  assert.match(namePrompt.body, /speechTimeout="2"/);
  const confirmation = await answer(callSid, 'Ján Novák');
  assert.match(confirmation.body, /Ďakujem\. Prosím, potvrďte rezerváciu/);
  assert.match(confirmation.body, /voice="Google\.sk-SK-Wavenet-B"/);
  assert.doesNotMatch(confirmation.body, /<Play>/);
  assert.match(confirmation.body, /v trvaní tridsať minút/);
  assert.match(confirmation.body, /MUDr\. Dávid Anovčin/);
  assert.match(confirmation.body, /timeout="4"/);
  assert.match(confirmation.body, /speechTimeout="auto"/);
  assert.equal(bookingInputs.length, 0);
  const completed = await answer(callSid, 'annon');

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

test('neúplné meno sa zopakuje bez opätovného čítania zhrnutia rezervácie', async () => {
  const callSid = 'CA-NIMALA-NAME-RETRY-000000000000001';
  await incoming(callSid);
  await answer(callSid, 'Chcem preventívnu prehliadku na urológii');
  await answer(callSid, 'dva');

  const retry = await answer(callSid, 'Matej');

  assert.match(retry.body, /meno som nezachytila celé/);
  assert.match(retry.body, /ešte raz svoje meno a priezvisko/);
  assert.doesNotMatch(retry.body, /Len to ešte pre istotu zhrniem/);
  assert.doesNotMatch(retry.body, /Vybraný typ vyšetrenia/);
  assert.match(retry.body, /bargeIn="true"/);
  assert.match(retry.body, /speechTimeout="2"/);
});

test('pacient si môže nechať zopakovať voľné termíny a potom pokračovať výberom', async () => {
  const callSid = 'CA-NIMALA-REPEAT-SLOTS-000000000001';
  await incoming(callSid);
  const firstOffer = await answer(callSid, 'Chcem preventívnu prehliadku na urológii');
  const repeatedOffer = await answer(callSid, 'Zopakujte mi, prosím, voľné termíny');

  assert.match(firstOffer.body, /Možnosť jedna/);
  assert.match(repeatedOffer.body, /Možnosť jedna/);
  assert.match(repeatedOffer.body, /Možnosť dva/);
  assert.match(repeatedOffer.body, /Možnosť tri/);
  assert.match(repeatedOffer.body, /šestnásteho novembra/);
  assert.match(repeatedOffer.body, /sedemnásteho novembra/);
  assert.equal(bookingInputs.length, 0);

  const summary = await answer(callSid, 'dva');
  assert.match(summary.body, /Len to ešte pre istotu zhrniem/);
  assert.match(summary.body, /sedemnásteho novembra, o desiatej tridsať/);
});

test('existujúca rezervácia sa po overení telefónu presunie až po potvrdení', async () => {
  const callSid = 'CA-NIMALA-RESCHEDULE-000000000000001';
  await incoming(callSid);
  const offer = await answer(callSid, 'Potrebujem zmeniť termín rezervácie');

  assert.deepEqual(verificationInputs, [{ clinicId: 168, phone: '+421905111222' }]);
  assert.match(offer.body, /Mám pre vás tieto voľné termíny/);
  assert.equal(rescheduleInputs.length, 0);

  const confirmation = await answer(callSid, 'dva');
  assert.match(confirmation.body, /potvrďte.*zmenu rezervácie/i);
  assert.match(confirmation.body, /Pôvodný termín/);
  assert.match(confirmation.body, /Nový termín/);

  const completed = await answer(callSid, 'áno');
  assert.equal(rescheduleInputs.length, 1);
  assert.equal(rescheduleInputs[0].bookingId, 456);
  assert.equal(rescheduleInputs[0].clinicId, 168);
  assert.equal(rescheduleInputs[0].calendarId, 7);
  assert.equal(rescheduleInputs[0].eventTypeUid, 'preventive-exam');
  assert.equal(rescheduleInputs[0].startAt, '2026-11-17T10:30:00+01:00');
  assert.equal(rescheduleInputs[0].verificationToken, 'patient-token');
  assert.match(rescheduleInputs[0].idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.match(completed.body, /úspešne zmenený/);
  assert.match(completed.body, /poslali e-mailom/);
  assert.equal(sentEvents.length, 0);
});

test('existujúca rezervácia sa zruší až po výslovnom potvrdení', async () => {
  const callSid = 'CA-NIMALA-CANCEL-00000000000000001';
  await incoming(callSid);
  const confirmation = await answer(callSid, 'Chcem zrušiť termín');

  assert.deepEqual(verificationInputs, [{ clinicId: 168, phone: '+421905111222' }]);
  assert.match(confirmation.body, /potvrďte zrušenie rezervácie/i);
  assert.equal(cancellationInputs.length, 0);

  const completed = await answer(callSid, 'áno');
  assert.equal(cancellationInputs.length, 1);
  assert.equal(cancellationInputs[0].bookingId, 456);
  assert.equal(cancellationInputs[0].clinicId, 168);
  assert.equal(cancellationInputs[0].verificationToken, 'patient-token');
  assert.match(cancellationInputs[0].idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.match(completed.body, /úspešne zrušená/);
  assert.equal(sentEvents.length, 0);
});

test('odmietnutie potvrdenia nezruší rezerváciu ani nevytvorí požiadavku', async () => {
  const callSid = 'CA-NIMALA-CANCEL-DECLINED-00000000001';
  await incoming(callSid);
  const confirmation = await answer(callSid, 'Chcem zrušiť rezerváciu');

  assert.match(confirmation.body, /potvrďte zrušenie rezervácie/i);
  const completed = await answer(callSid, 'nie');

  assert.equal(cancellationInputs.length, 0);
  assert.equal(sentEvents.length, 0);
  assert.match(completed.body, /Rezerváciu som nezrušila/);
});

test('nejednoznačný telefón neprezradí rezervácie a odovzdá požiadavku personálu', async () => {
  prixiCalendarService.verifyPatient = async input => {
    verificationInputs.push(input);
    return { status: 'verification_failed', httpStatus: 403, code: 'VERIFICATION_FAILED' };
  };
  const callSid = 'CA-NIMALA-AMBIGUOUS-0000000000001';
  await incoming(callSid);
  const response = await answer(callSid, 'Chcem prebookovať termín');
  await new Promise(resolve => setImmediate(resolve));

  assert.match(response.body, /nepodarilo pacienta jednoznačne overiť/);
  assert.doesNotMatch(response.body, /Našla som tieto budúce rezervácie|Pôvodný termín/);
  assert.equal(rescheduleInputs.length, 0);
  assert.equal(cancellationInputs.length, 0);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Kategória: zmena termínu/);
});

test('dynamická ponuka termínov používa ElevenLabs a krátkodobý μ-law media endpoint', async () => {
  const originalSynthesize = elevenLabsTtsService.synthesizeForPhone;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  let synthesizedText = '';
  let synthesizedConfig;
  elevenLabsTtsService.synthesizeForPhone = async (text, config) => {
    synthesizedText = text;
    synthesizedConfig = config;
    return Buffer.from([255, 127, 0, 42]);
  };

  try {
    const callSid = 'CA-NIMALA-ELEVENLABS-0000000000001';
    await incoming(callSid);
    const offer = await answer(callSid, 'Chcem preventívnu prehliadku na urológii');
    const mediaUrl = offer.body.match(/<Play>(https:[^<]+\/media\/nimala-dynamic\/[^<]+\.ulaw)<\/Play>/)?.[1];

    assert.ok(mediaUrl);
    assert.match(synthesizedText, /Mám pre vás tieto voľné termíny/);
    assert.match(synthesizedText, /Možnosť jedna\. Termín je v pondelok, šestnásteho novembra, o deviatej/);
    assert.match(synthesizedText, /Možnosť dva\. Termín je v utorok, sedemnásteho novembra, o desiatej tridsať/);
    assert.equal(synthesizedConfig.voiceId, 'zGjIP4SZlMnY9m93k97r');
    assert.equal(synthesizedConfig.modelId, 'eleven_flash_v2_5');
    assert.equal(synthesizedConfig.languageCode, 'sk');
    assert.equal(synthesizedConfig.voiceSettings.speed, 0.92);
    assert.doesNotMatch(offer.body, /Google\.sk-SK-Wavenet-B/);

    const media = await app.inject({ method: 'GET', url: new URL(mediaUrl).pathname });
    assert.equal(media.statusCode, 200);
    assert.match(media.headers['content-type'], /^audio\/ulaw/);
    assert.deepEqual([...media.rawPayload], [255, 127, 0, 42]);
    assert.equal(media.headers['cache-control'], 'private, no-store, max-age=0');
  } finally {
    elevenLabsTtsService.synthesizeForPhone = originalSynthesize;
    delete process.env.ELEVENLABS_API_KEY;
  }
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
  assert.match(urologyMenu.body, /Rozumiem, ide o urológiu/);
  assert.match(urologyMenu.body, /zmeniť alebo zrušiť termín/);

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
  assert.match(sentEvents[0].problemTranscript, /Výsledok rezervácie sa nepodarilo spoľahlivo overiť/);
  assert.doesNotMatch(sentEvents[0].problemTranscript, /Rezervácia nebola potvrdená Calendar API/);
});

test('timeout presunu zopakuje identický payload a idempotency kľúč a odovzdá kontrolu personálu', async () => {
  prixiCalendarService.rescheduleBooking = async input => {
    rescheduleInputs.push(input);
    return { status: 'uncertain', message: 'timeout' };
  };
  const callSid = 'CA-NIMALA-RESCHEDULE-TIMEOUT-0000001';
  await incoming(callSid);
  await answer(callSid, 'Potrebujem presunúť termín');
  await answer(callSid, 'dva');
  const response = await answer(callSid, 'áno');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(rescheduleInputs.length, 2);
  assert.deepEqual(rescheduleInputs[1], rescheduleInputs[0]);
  assert.match(response.body, /nepodarilo bezpečne dokončiť/);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Výsledok zmeny sa nepodarilo spoľahlivo overiť/);
});

test('nedokončené potvrdenie presne vysvetlí, že rezervácia nebola odoslaná do Calendar API', async () => {
  const callSid = 'CA-NIMALA-UNCONFIRMED-000000000001';
  await incoming(callSid);
  await answer(callSid, 'Chcem preventívnu prehliadku na urológii');
  await answer(callSid, 'dva');
  await answer(callSid, 'Matej Skok');
  await answer(callSid, 'nejasná odpoveď');
  await post('/voice/call-status', {
    CallSid: callSid,
    CallStatus: 'completed',
    From: '+421905111222',
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(bookingInputs.length, 0);
  assert.equal(sentEvents.length, 1);
  assert.match(sentEvents[0].problemTranscript, /Rezervácia nebola odoslaná do Calendar API, pretože pacient nedokončil jej potvrdenie/);
  assert.doesNotMatch(sentEvents[0].problemTranscript, /Rezervácia nebola potvrdená Calendar API/);
});

