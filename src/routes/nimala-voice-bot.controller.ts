import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import twilio from 'twilio';
import { v4 as uuidv4 } from 'uuid';
import {
  NimalaAudioKey,
  nimalaAudioFiles,
  nimalaAudioMediaPath,
} from '../config/nimala-audio.config';
import {
  nimalaBotConfig,
  NimalaAppointmentType,
  NimalaRequestType,
} from '../config/nimala.config';
import {
  parseNimalaAppointmentType,
  parseNimalaBirthYear,
  parseNimalaDepartment,
  parseNimalaMainMenu,
  parseNimalaName,
  parseNimalaChoice,
  parseNimalaSlotChoice,
  parseNimalaYesNo,
  isNimalaRepeatSlotsRequest,
  normalizeNimalaSpeech,
  NimalaDepartment,
} from '../services/nimala-nlu.service';
import { NimalaSession, nimalaSessionService } from '../services/nimala-session.service';
import {
  CreatePrixiBookingInput,
  PrixiCalendarService,
  PrixiCalendarSlot,
  PrixiPatientBooking,
  prixiCalendarService,
} from '../services/prixi-calendar.service';
import { prixiService } from '../services/prixi.service';
import { elevenLabsTtsService } from '../services/elevenlabs-tts.service';
import { nimalaDynamicAudioService } from '../services/nimala-dynamic-audio.service';
import { VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, createVoiceEventKey, failVoiceEvent } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

interface NimalaSpokenResponse {
  text: string;
  audioKeys: NimalaAudioKey[];
  dynamic?: boolean;
}

function spoken(text: string, ...audioKeys: NimalaAudioKey[]): NimalaSpokenResponse {
  return { text, audioKeys };
}

function dynamicSpoken(text: string): NimalaSpokenResponse {
  return { text, audioKeys: [], dynamic: true };
}

const copy = {
  greeting: spoken('Dobrý deň, som PriXi, virtuálna asistentka kliniky Nimala. V tejto demo verzii vám viem pomôcť s urologickou ambulanciou. Povedzte mi, prosím, kvôli čomu voláte. Ak voláte kvôli inému odboru, povedzte jeho názov.', 'greeting'),
  urologyMenu: dynamicSpoken('Rozumiem, ide o urológiu. Potrebujete sa objednať, zmeniť alebo zrušiť termín, požiadať o e-recept, informovať sa o výsledkoch, alebo hovoriť s človekom?'),
  appointmentType: spoken('Rozumiem, rada vám pomôžem s objednaním. Vyberte si, prosím, typ vyšetrenia. Pre VIP termín urológia stlačte jednotku. Pre preventívnu prehliadku dvojku. Pre konzultáciu trojku. Pre kontrolu po operácii štvorku. Pre konzultáciu k operácii prostaty vodnou parou päťku. Pre U F M stlačte šestku.', 'appointmentType'),
  name: spoken('Ďakujem. Povedzte, prosím, svoje meno a priezvisko.', 'askName'),
  birthYear: spoken('Ďakujem. Povedzte, prosím, svoj rok narodenia.', 'askBirthYear'),
  prescriptionDetail: spoken('Ďakujem. Povedzte, prosím, názov lieku, jeho silu a počet balení.', 'prescriptionDetail'),
  resultsDetail: spoken('Ďakujem. Povedzte, prosím, o aké výsledky ide a približný dátum vyšetrenia.', 'resultsDetail'),
  retry: spoken('Prepáčte, nerozumela som. Skúste to, prosím, ešte raz.', 'retry'),
  selectDifferentSlot: spoken('Rozumiem. Vyberte si, prosím, iný termín.', 'selectDifferentSlot'),
  slotBecameUnavailable: spoken('Tento termín sa medzitým obsadil. Pozrime sa na ďalšie voľné možnosti.', 'slotBecameUnavailable'),
  transferStart: spoken('Rozumiem. Prepájam vás na pracovníka kliniky. Prosím, zostaňte na linke.', 'transferStart'),
  farewell: spoken('Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'farewell'),
  prescriptionComplete: spoken('Požiadavku na e-recept sme zaznamenali. Klinika ju po overení spracuje a bude vás informovať. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'prescriptionComplete'),
  resultsComplete: spoken('Požiadavku na informácie o výsledkoch sme zaznamenali. Klinika vás bude kontaktovať. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'resultsComplete'),
  transferComplete: spoken('Ďakujem za zavolanie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'transferComplete'),
  aestheticsUnavailable: spoken('Ďakujem. Vybrali ste odbor estetika. Táto ambulancia zatiaľ nie je v demo verzii hlasovej asistentky aktívna. Momentálne môžete pokračovať iba s urologickou ambulanciou. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'aestheticsUnavailable'),
  ultrasoundUnavailable: spoken('Ďakujem. Vybrali ste odbor sonografia. Táto ambulancia zatiaľ nie je v demo verzii hlasovej asistentky aktívna. Momentálne môžete pokračovať iba s urologickou ambulanciou. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'ultrasoundUnavailable'),
  proctologyUnavailable: spoken('Ďakujem. Vybrali ste odbor proktológia. Táto ambulancia zatiaľ nie je v demo verzii hlasovej asistentky aktívna. Momentálne môžete pokračovať iba s urologickou ambulanciou. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'proctologyUnavailable'),
  dermatologyUnavailable: spoken('Ďakujem. Vybrali ste odbor dermatológia. Táto ambulancia zatiaľ nie je v demo verzii hlasovej asistentky aktívna. Momentálne môžete pokračovať iba s urologickou ambulanciou. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'dermatologyUnavailable'),
  noFreeSlot: spoken('Pre tento typ vyšetrenia momentálne nevidím voľný termín. Vašu požiadavku odovzdám klinike, ktorá vás bude kontaktovať. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'noFreeSlot'),
  transferUnavailable: spoken('Momentálne vás neviem bezpečne prepojiť. Vašu žiadosť o telefonický kontakt som odovzdala klinike. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'transferUnavailable'),
  transferNotAnswered: spoken('Pracovníka kliniky sa teraz nepodarilo zastihnúť. Vašu žiadosť o telefonický kontakt sme zaznamenali. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'transferNotAnswered'),
  expired: spoken('Hovor sa nepodarilo dokončiť. Zavolajte, prosím, znova. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'expired'),
  technical: spoken('Momentálne sa neviem bezpečne spojiť s rezervačným systémom. Vašu požiadavku odovzdám personálu kliniky. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'technical'),
  bookingFailed: dynamicSpoken('Rezerváciu sa momentálne nepodarilo dokončiť. Vašu požiadavku som odovzdala personálu kliniky, ktorý ju preverí. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.'),
  startupTechnical: spoken('Momentálne máme technické problémy. Skúste, prosím, zavolať neskôr. Ďakujem za pochopenie a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'startupTechnical'),
  bookingStatusUncertain: spoken('Výsledok rezervácie sa mi nepodarilo spoľahlivo overiť. Aby nevznikla duplicitná rezervácia, požiadavku preverí personál kliniky a bude vás kontaktovať. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.', 'bookingStatusUncertain'),
  noSlotInSession: spoken('Momentálne som nenašla žiadny voľný termín.', 'noSlotInSession'),
  patientVerificationFailed: dynamicSpoken('Z tohto telefónneho čísla sa mi nepodarilo pacienta jednoznačne overiť. Vašu požiadavku odovzdám personálu kliniky, ktorý vás bude kontaktovať. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.'),
  noUpcomingBookings: dynamicSpoken('Pre toto telefónne číslo som nenašla žiadnu budúcu rezerváciu, ktorú by bolo možné zmeniť alebo zrušiť. Vašu požiadavku odovzdám personálu kliniky. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.'),
  managementFailed: dynamicSpoken('Zmenu rezervácie sa momentálne nepodarilo bezpečne dokončiť. Vašu požiadavku odovzdám personálu kliniky, ktorý ju preverí. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.'),
  cancellationDeclined: dynamicSpoken('Rozumiem. Rezerváciu som nezrušila. Ďakujem a prajem vám ešte príjemný zvyšok dňa. Dovidenia.'),
};

const requestLabels: Record<NimalaRequestType, string> = {
  appointment: 'objednanie na vyšetrenie',
  reschedule: 'zmena termínu',
  cancel: 'zrušenie termínu',
  prescription: 'žiadosť o e-recept',
  results: 'informácie o výsledkoch vyšetrenia',
  human: 'žiadosť o spojenie s človekom',
};

const appointmentLabels: Record<NimalaAppointmentType, string> = Object.fromEntries(
  Object.entries(nimalaBotConfig.booking.services).map(([key, service]) => [key, service.label])
) as Record<NimalaAppointmentType, string>;

function unsupportedDepartmentMessage(department: Exclude<NimalaDepartment, 'urology'>): NimalaSpokenResponse {
  const messages = {
    aesthetics: copy.aestheticsUnavailable,
    ultrasound: copy.ultrasoundUnavailable,
    proctology: copy.proctologyUnavailable,
    dermatology: copy.dermatologyUnavailable,
  };
  return messages[department];
}

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function formatSlot(slot: PrixiCalendarSlot): string {
  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: nimalaBotConfig.clinic.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(slot.startAt));
}

const spokenWeekdays = [
  'v pondelok',
  'v utorok',
  'v stredu',
  'vo štvrtok',
  'v piatok',
  'v sobotu',
  'v nedeľu',
];

const spokenMonths = [
  'januára',
  'februára',
  'marca',
  'apríla',
  'mája',
  'júna',
  'júla',
  'augusta',
  'septembra',
  'októbra',
  'novembra',
  'decembra',
];

const spokenMonthDays = [
  '',
  'prvého', 'druhého', 'tretieho', 'štvrtého', 'piateho', 'šiesteho', 'siedmeho', 'ôsmeho', 'deviateho', 'desiateho',
  'jedenásteho', 'dvanásteho', 'trinásteho', 'štrnásteho', 'pätnásteho', 'šestnásteho', 'sedemnásteho', 'osemnásteho', 'devätnásteho', 'dvadsiateho',
  'dvadsiateho prvého', 'dvadsiateho druhého', 'dvadsiateho tretieho', 'dvadsiateho štvrtého', 'dvadsiateho piateho', 'dvadsiateho šiesteho', 'dvadsiateho siedmeho', 'dvadsiateho ôsmeho', 'dvadsiateho deviateho', 'tridsiateho', 'tridsiateho prvého',
];

const spokenHours = [
  'polnoci', 'jednej', 'druhej', 'tretej', 'štvrtej', 'piatej', 'šiestej', 'siedmej', 'ôsmej', 'deviatej', 'desiatej', 'jedenástej',
  'dvanástej', 'trinástej', 'štrnástej', 'pätnástej', 'šestnástej', 'sedemnástej', 'osemnástej', 'devätnástej', 'dvadsiatej', 'dvadsiatej prvej', 'dvadsiatej druhej', 'dvadsiatej tretej',
];

const smallCardinals = [
  'nula', 'jeden', 'dva', 'tri', 'štyri', 'päť', 'šesť', 'sedem', 'osem', 'deväť', 'desať',
  'jedenásť', 'dvanásť', 'trinásť', 'štrnásť', 'pätnásť', 'šestnásť', 'sedemnásť', 'osemnásť', 'devätnásť',
];

function spokenCardinal(value: number): string {
  if (value < 20) return smallCardinals[value];
  const tens = value < 30 ? 'dvadsať' : value < 40 ? 'tridsať' : value < 50 ? 'štyridsať' : 'päťdesiat';
  return value % 10 ? `${tens}${smallCardinals[value % 10]}` : tens;
}

export function formatNimalaSlotForSpeech(slot: PrixiCalendarSlot): string {
  const date = DateTime.fromISO(slot.startAt, { setZone: true }).setZone(nimalaBotConfig.clinic.timezone);
  if (!date.isValid) return formatSlot(slot);
  const minute = date.minute === 0
    ? ''
    : ` ${date.minute < 10 ? `nula ${spokenCardinal(date.minute)}` : spokenCardinal(date.minute)}`;
  return `${spokenWeekdays[date.weekday - 1]}, ${spokenMonthDays[date.day]} ${spokenMonths[date.month - 1]}, o ${spokenHours[date.hour]}${minute}`;
}

function slotOffer(session: NimalaSession): NimalaSpokenResponse {
  const slots = session.offeredSlots || [];
  if (!slots.length) return copy.noSlotInSession;
  const optionNames = ['jedna', 'dva', 'tri'];
  return dynamicSpoken(`Ďakujem. Mám pre vás tieto voľné termíny. ${slots.map((slot, index) => `Možnosť ${optionNames[index] || index + 1}. Termín je ${formatNimalaSlotForSpeech(slot)}.`).join(' ')} Povedzte číslo možnosti alebo ho stlačte na klávesnici.`);
}

function bookingConfirmation(session: NimalaSession): NimalaSpokenResponse {
  const service = session.appointmentType ? appointmentLabels[session.appointmentType] : 'vyšetrenie';
  const slot = session.selectedSlot ? formatNimalaSlotForSpeech(session.selectedSlot) : 'vybraný termín';
  const doctor = session.selectedSlot?.calendarName || 'MUDr. Dávid Anovčin';
  const duration = session.selectedSlot?.durationMinutes
    || (session.appointmentType ? serviceDefinition(session.appointmentType).durationMinutes : undefined);
  return dynamicSpoken(`Ďakujem. Prosím, potvrďte rezerváciu: ${service}${duration ? ` v trvaní ${spokenCardinal(duration)} minút` : ''}, ${slot}, u lekára ${doctor}. Ak sú údaje správne, povedzte áno alebo stlačte jednotku. Ak chcete vybrať iný termín, povedzte nie alebo stlačte dvojku.`);
}

function selectedSlotSummary(session: NimalaSession): NimalaSpokenResponse {
  if (!session.selectedSlot || !session.appointmentType) return copy.name;
  const service = appointmentLabels[session.appointmentType];
  const doctor = session.selectedSlot.calendarName || 'MUDr. Dávid Anovčin';
  return dynamicSpoken(`Ďakujem, rozumiem. Len to ešte pre istotu zhrniem. Vybraný typ vyšetrenia je ${service}. Termín je ${formatNimalaSlotForSpeech(session.selectedSlot)}, u lekára ${doctor}. Pred potvrdením rezervácie mi ešte povedzte svoje meno a priezvisko.`);
}

function managedBookingName(booking: PrixiPatientBooking): string {
  return booking.serviceName || 'urologické vyšetrenie';
}

function existingBookingOffer(session: NimalaSession): NimalaSpokenResponse {
  const bookings = session.offeredBookings || [];
  const optionNames = ['jedna', 'dva', 'tri'];
  return dynamicSpoken(`Našla som tieto budúce rezervácie. ${bookings.map((booking, index) => `Možnosť ${optionNames[index] || index + 1}. ${managedBookingName(booking)}, ${formatNimalaSlotForSpeech(booking)}, u lekára ${booking.calendarName || 'ambulancie'}.`).join(' ')} Povedzte číslo rezervácie, ktorú chcete ${session.requestType === 'cancel' ? 'zrušiť' : 'zmeniť'}, alebo ho stlačte na klávesnici.`);
}

function rescheduleConfirmation(session: NimalaSession): NimalaSpokenResponse {
  const original = session.selectedBooking;
  const replacement = session.selectedSlot;
  if (!original || !replacement) return copy.technical;
  return dynamicSpoken(`Ďakujem, rozumiem. Len to ešte pre istotu zhrniem. Pôvodný termín je ${formatNimalaSlotForSpeech(original)}. Nový termín je ${formatNimalaSlotForSpeech(replacement)}, u lekára ${replacement.calendarName || original.calendarName || 'ambulancie'}. Potvrďte, prosím, zmenu rezervácie slovom áno alebo stlačením jednotky. Ak chcete vybrať iný termín, povedzte nie alebo stlačte dvojku.`);
}

function cancellationConfirmation(session: NimalaSession): NimalaSpokenResponse {
  const booking = session.selectedBooking;
  if (!booking) return copy.technical;
  return dynamicSpoken(`Prosím, potvrďte zrušenie rezervácie: ${managedBookingName(booking)}, ${formatNimalaSlotForSpeech(booking)}, u lekára ${booking.calendarName || 'ambulancie'}. Ak ju chcete naozaj zrušiť, povedzte áno alebo stlačte jednotku. Ak ju nechcete zrušiť, povedzte nie alebo stlačte dvojku.`);
}

function promptFor(session: NimalaSession): NimalaSpokenResponse {
  switch (session.step) {
    case 'intent': return copy.greeting;
    case 'main_menu': return copy.urologyMenu;
    case 'appointment_type': return copy.appointmentType;
    case 'slot': return slotOffer(session);
    case 'name': return session.requestType === 'appointment' ? selectedSlotSummary(session) : copy.name;
    case 'birth_year': return copy.birthYear;
    case 'detail': return session.requestType === 'prescription' ? copy.prescriptionDetail : copy.resultsDetail;
    case 'booking_confirmation': return bookingConfirmation(session);
    case 'existing_booking': return existingBookingOffer(session);
    case 'reschedule_slot': return slotOffer(session);
    case 'reschedule_confirmation': return rescheduleConfirmation(session);
    case 'cancel_confirmation': return cancellationConfirmation(session);
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

function publicBaseUrl(request: FastifyRequest): string {
  const protocol = firstHeader(request.headers['x-forwarded-proto']) || 'https';
  const host = firstHeader(request.headers['x-forwarded-host']) || firstHeader(request.headers.host) || 'localhost';
  return (process.env.PUBLIC_BASE_URL || `${protocol}://${host}`).replace(/\/$/, '');
}

function hasAudioFiles(audioKeys: NimalaAudioKey[]): boolean {
  return audioKeys.every(key => existsSync(resolve(__dirname, '../assets/audio', nimalaAudioFiles[key])));
}

async function appendSpoken(
  twiml: { play(url: string): unknown; say(options: any, text: string): unknown },
  request: FastifyRequest,
  content: NimalaSpokenResponse
): Promise<void> {
  if (content.dynamic && elevenLabsTtsService.isConfigured()) {
    try {
      const audio = await elevenLabsTtsService.synthesizeForPhone(content.text, nimalaBotConfig.tts);
      const token = nimalaDynamicAudioService.put(audio);
      twiml.play(`${publicBaseUrl(request)}/media/nimala-dynamic/${token}.ulaw`);
      return;
    } catch (error) {
      request.log.warn(
        { message: error instanceof Error ? error.message : String(error) },
        'ElevenLabs dynamic TTS failed; using Google fallback'
      );
    }
  }

  if (!content.audioKeys.length || !hasAudioFiles(content.audioKeys)) {
    twiml.say(sayOptions, content.text);
    return;
  }

  const baseUrl = publicBaseUrl(request);
  for (const audioKey of content.audioKeys) {
    twiml.play(`${baseUrl}${nimalaAudioMediaPath(audioKey)}`);
  }
}

function hintsFor(session: NimalaSession): string {
  if (session.step === 'intent' || session.step === 'main_menu') {
    return 'objednať sa, rezervovať termín, zmeniť termín, presunúť termín, preobjednať, zrušiť termín, stornovať rezerváciu, preventívna prehliadka, konzultácia, e-recept, predpísať liek, výsledky vyšetrenia, urológia, estetika, sonografia, proktológia, dermatológia, hovoriť s človekom';
  }
  if (session.step === 'appointment_type') {
    return 'VIP termín urológia, preventívna prehliadka, konzultácia, kontrola po operácii, operácia prostaty vodnou parou, UFM, uroflowmetria, jedna, dva, tri, štyri, päť, šesť';
  }
  if (session.step === 'slot' || session.step === 'reschedule_slot') {
    return 'možnosť jedna, možnosť dva, možnosť tri, prvý termín, druhý termín, tretí termín, jedna, dva, tri, zopakujte termíny, zopakovať možnosti, ešte raz, znova';
  }
  if (session.step === 'existing_booking') {
    return 'možnosť jedna, možnosť dva, možnosť tri, prvá rezervácia, druhá rezervácia, tretia rezervácia, jedna, dva, tri';
  }
  if (session.step === 'booking_confirmation' || session.step === 'reschedule_confirmation' || session.step === 'cancel_confirmation') {
    return 'áno, súhlasím, potvrdzujem, správne, platí, nie, iný termín, zmeniť termín';
  }
  return '';
}

async function renderPrompt(
  reply: FastifyReply,
  session: NimalaSession,
  prefix?: NimalaSpokenResponse
): Promise<FastifyReply> {
  nimalaSessionService.save(session);
  const twiml = new VoiceResponse();
  const menuStep = ['intent', 'main_menu', 'appointment_type', 'slot', 'booking_confirmation', 'existing_booking', 'reschedule_slot', 'reschedule_confirmation', 'cancel_confirmation'].includes(session.step);
  const shortAnswerStep = menuStep || session.step === 'birth_year';
  // Put the prompt inside Gather so Twilio can stop it and process the caller's
  // speech or DTMF immediately (barge-in), without waiting for playback to end.
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/nimala/answer',
    method: 'POST',
    timeout: shortAnswerStep ? 4 : 6,
    speechTimeout: shortAnswerStep ? 'auto' : 1,
    language: 'sk-SK',
    hints: hintsFor(session),
    ...(menuStep ? { numDigits: 1 } : {}),
  } as any);
  if (prefix) await appendSpoken(gather, reply.request, prefix);
  await appendSpoken(gather, reply.request, promptFor(session));
  twiml.redirect('/voice/nimala/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

async function renderEnd(reply: FastifyReply, message: NimalaSpokenResponse): Promise<FastifyReply> {
  const twiml = new VoiceResponse();
  await appendSpoken(twiml, reply.request, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function normalizePhone(value?: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (value.trim().startsWith('+')) return `+${digits}`;
  if (digits.startsWith('0')) return `+421${digits.slice(1)}`;
  return digits ? `+${digits}` : '';
}

function humanDestination(): string | undefined {
  const destination = normalizePhone(process.env[nimalaBotConfig.handoff.destinationEnv]);
  if (!/^\+\d{8,15}$/.test(destination)) return undefined;
  const forbidden = new Set([
    normalizePhone(nimalaBotConfig.clinic.inboundTwilioNumber),
    normalizePhone(nimalaBotConfig.clinic.routingPhoneNumber),
  ]);
  return forbidden.has(destination) ? undefined : destination;
}

async function resolveClinicId(): Promise<string> {
  const candidates = [nimalaBotConfig.clinic.inboundTwilioNumber, nimalaBotConfig.clinic.routingPhoneNumber];
  const failures: string[] = [];
  for (const phone of candidates) {
    const config = await prixiService.getConfig(phone);
    const clinicId = String(config.clinicId ?? '').trim();
    if (config.voiceBotEnabled === true && clinicId === nimalaBotConfig.clinic.clinicId) return clinicId;
    failures.push(`${phone}: ${clinicId || '<missing>'}`);
  }
  throw new Error(`Blocked Nimala route: expected clinic 168 (${failures.join('; ')})`);
}

function serviceDefinition(type: NimalaAppointmentType) {
  return nimalaBotConfig.booking.services[type];
}

function canonicalServiceName(value: string): string {
  return normalizeNimalaSpeech(value)
    .replace(/\b\d+\s*(?:min|minut\p{L}*)\b/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesService(catalogService: PrixiCalendarService, type: NimalaAppointmentType): boolean {
  const catalogName = canonicalServiceName(catalogService.name);
  const service = serviceDefinition(type);
  return [service.label, ...service.aliases].some(alias => canonicalServiceName(alias) === catalogName);
}

async function loadAvailableSlots(session: NimalaSession): Promise<boolean> {
  if (!session.appointmentType) return false;
  const clinicId = Number(session.clinicId);
  const services = await prixiCalendarService.listServices(clinicId);
  const service = services.find(candidate => matchesService(candidate, session.appointmentType!));
  if (!service) throw new Error(`Nimala service is not available in PriXi: ${session.appointmentType}`);
  const now = DateTime.now().setZone(nimalaBotConfig.clinic.timezone);
  const slots = await prixiCalendarService.getAvailableSlots({
    clinicId,
    eventTypeUid: service.eventTypeUid,
    from: now.toISODate()!,
    to: now.plus({ days: nimalaBotConfig.booking.availabilityDays }).toISODate()!,
    limit: 30,
  });
  const unique = new Map(slots.map(slot => [`${slot.startAt}:${slot.calendarId}`, slot]));
  session.eventTypeUid = service.eventTypeUid;
  session.offeredSlots = [...unique.values()].slice(0, nimalaBotConfig.booking.offeredSlotCount);
  session.selectedSlot = undefined;
  return session.offeredSlots.length > 0;
}

async function continueWithAppointmentType(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession,
  appointmentType: NimalaAppointmentType
): Promise<FastifyReply> {
  session.appointmentType = appointmentType;
  session.attempts = 0;
  try {
    const hasSlots = await loadAvailableSlots(session);
    if (!hasSlots) {
      return callbackFallback(fastify, reply, session, copy.noFreeSlot);
    }
    session.step = 'slot';
    return renderPrompt(reply, session);
  } catch (error) {
    fastify.log.error(error, 'Failed to load Nimala availability');
    return callbackFallback(fastify, reply, session, copy.technical);
  }
}

async function loadRescheduleSlots(session: NimalaSession): Promise<boolean> {
  const booking = session.selectedBooking;
  if (!booking) return false;
  const now = DateTime.now().setZone(nimalaBotConfig.clinic.timezone);
  const slots = await prixiCalendarService.getAvailableSlots({
    clinicId: Number(session.clinicId),
    eventTypeUid: booking.eventTypeUid,
    from: now.toISODate()!,
    to: now.plus({ days: nimalaBotConfig.booking.availabilityDays }).toISODate()!,
    limit: 30,
  });
  const unique = new Map(
    slots
      .filter(slot => slot.startAt !== booking.startAt || slot.calendarId !== booking.calendarId)
      .map(slot => [`${slot.startAt}:${slot.calendarId}`, slot])
  );
  session.eventTypeUid = booking.eventTypeUid;
  session.offeredSlots = [...unique.values()].slice(0, nimalaBotConfig.booking.offeredSlotCount);
  session.selectedSlot = undefined;
  return session.offeredSlots.length > 0;
}

async function continueWithManagedBooking(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession,
  booking: PrixiPatientBooking
): Promise<FastifyReply> {
  session.selectedBooking = booking;
  session.attempts = 0;
  if (session.requestType === 'cancel') {
    session.step = 'cancel_confirmation';
    return renderPrompt(reply, session);
  }
  try {
    const hasSlots = await loadRescheduleSlots(session);
    if (!hasSlots) return callbackFallback(fastify, reply, session, copy.noFreeSlot);
    session.step = 'reschedule_slot';
    return renderPrompt(reply, session);
  } catch (error) {
    fastify.log.error(error, 'Failed to load Nimala reschedule availability');
    return callbackFallback(fastify, reply, session, copy.technical);
  }
}

async function beginBookingManagement(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession,
  requestType: 'reschedule' | 'cancel'
): Promise<FastifyReply> {
  session.requestType = requestType;
  session.attempts = 0;
  const verification = await prixiCalendarService.verifyPatient({
    clinicId: Number(session.clinicId),
    phone: normalizePhone(session.phone),
  });
  if (verification.status !== 'verified') {
    fastify.log.warn({
      callSid: session.callSid,
      verificationStatus: verification.status,
      httpStatus: verification.httpStatus,
      apiCode: verification.code,
    }, 'Nimala patient verification did not succeed');
    const message = verification.status === 'uncertain' || verification.status === 'failed'
      ? copy.technical
      : copy.patientVerificationFailed;
    return callbackFallback(fastify, reply, session, message);
  }
  session.patientVerificationToken = verification.verificationToken;

  const listed = await prixiCalendarService.listPatientBookings(
    Number(session.clinicId),
    verification.verificationToken
  );
  if (listed.status !== 'ok') {
    fastify.log.warn({
      callSid: session.callSid,
      listStatus: listed.status,
      httpStatus: listed.httpStatus,
      apiCode: listed.code,
    }, 'Nimala patient bookings could not be loaded');
    return callbackFallback(
      fastify,
      reply,
      session,
      listed.status === 'verification_failed' ? copy.patientVerificationFailed : copy.technical
    );
  }
  if (!listed.bookings.length) return callbackFallback(fastify, reply, session, copy.noUpcomingBookings);

  let serviceNames = new Map<string, string>();
  try {
    const services = await prixiCalendarService.listServices(Number(session.clinicId));
    serviceNames = new Map(services.map(service => [service.eventTypeUid, service.name]));
  } catch (error) {
    fastify.log.warn(error, 'Nimala service names could not be loaded for managed bookings');
  }
  session.offeredBookings = listed.bookings.slice(0, 3).map(booking => ({
    ...booking,
    serviceName: booking.serviceName || serviceNames.get(booking.eventTypeUid),
  }));
  if (session.offeredBookings.length === 1) {
    return continueWithManagedBooking(fastify, reply, session, session.offeredBookings[0]);
  }
  session.step = 'existing_booking';
  return renderPrompt(reply, session);
}

async function continueWithRequestType(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession,
  requestType: NimalaRequestType,
  originalAnswer?: string
): Promise<FastifyReply> {
  session.requestType = requestType;
  session.attempts = 0;
  if (requestType === 'human') return handoffToHuman(fastify, reply, session);
  if (requestType === 'reschedule' || requestType === 'cancel') {
    return beginBookingManagement(fastify, reply, session, requestType);
  }
  if (requestType === 'appointment') {
    const appointmentType = originalAnswer ? parseNimalaAppointmentType(originalAnswer) : undefined;
    if (appointmentType) return continueWithAppointmentType(fastify, reply, session, appointmentType);
    session.step = 'appointment_type';
    return renderPrompt(reply, session);
  }
  session.step = 'name';
  return renderPrompt(reply, session);
}

function requestSummary(session: NimalaSession): string {
  if (session.requestType === 'prescription') return `Pacient žiada e-recept: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'results') return `Pacient žiada informácie o výsledkoch: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'human') return 'Pacient žiada telefonický kontakt s človekom.';
  if (session.requestType === 'reschedule') {
    const original = session.selectedBooking ? formatSlot(session.selectedBooking) : 'pôvodná rezervácia nebola vybraná';
    const replacement = session.selectedSlot ? formatSlot(session.selectedSlot) : 'nový termín nebol vybraný';
    const state = session.managementStatus === 'rescheduled'
      ? 'Termín bol úspešne zmenený.'
      : session.managementStatus === 'uncertain'
        ? 'Výsledok zmeny sa nepodarilo spoľahlivo overiť.'
        : 'Zmenu termínu sa nepodarilo dokončiť; požiadavka bola odovzdaná personálu.';
    return `Pacient žiada zmenu termínu z ${original} na ${replacement}. ${state}`;
  }
  if (session.requestType === 'cancel') {
    const booking = session.selectedBooking ? formatSlot(session.selectedBooking) : 'rezervácia nebola vybraná';
    const state = session.managementStatus === 'cancelled'
      ? 'Rezervácia bola úspešne zrušená.'
      : session.managementStatus === 'uncertain'
        ? 'Výsledok zrušenia sa nepodarilo spoľahlivo overiť.'
        : 'Zrušenie sa nepodarilo dokončiť; požiadavka bola odovzdaná personálu.';
    return `Pacient žiada zrušenie termínu ${booking}. ${state}`;
  }
  const service = session.appointmentType ? appointmentLabels[session.appointmentType] : 'nezistený typ vyšetrenia';
  const slot = session.selectedSlot ? formatSlot(session.selectedSlot) : 'termín nebol vybraný';
  const bookingState = session.bookingStatus === 'created'
    ? 'Rezervácia bola úspešne vytvorená cez Calendar API.'
    : session.bookingStatus === 'uncertain'
      ? 'Výsledok rezervácie sa nepodarilo spoľahlivo overiť; personál musí skontrolovať Calendar API.'
      : session.bookingStatus === 'slot_unavailable'
        ? 'Vybraný termín už nebol dostupný a pacient nedokončil výber náhradného termínu.'
        : session.bookingStatus === 'failed'
          ? 'Rezerváciu sa nepodarilo vytvoriť; požiadavka bola odovzdaná personálu.'
          : 'Rezervácia nebola odoslaná do Calendar API, pretože pacient nedokončil jej potvrdenie.';
  return `Pacient žiada objednanie na ${service}; ${slot}. ${bookingState}`;
}

function buildProblemTranscript(session: NimalaSession): string {
  return [
    '[Voice-bot Nimala – urológia MUDr. Dávida Anovčina]',
    `Stav hovoru: ${session.outcome === 'abandoned' ? 'NEDOKONČENÝ – volajúci zložil pred dokončením flow' : 'dokončený bez rezervácie'}`,
    `Kategória: ${session.requestType ? requestLabels[session.requestType] : 'nezistená'}`,
    ...(session.appointmentType ? [`Typ vyšetrenia: ${appointmentLabels[session.appointmentType]}`] : []),
    `Telefón: ${session.phone}`,
    `Meno a priezvisko: ${session.patientName || 'neuvedené'}`,
    `Rok narodenia: ${session.birthYear || 'neuvedený'}`,
    `**Zhrnutie:** ${requestSummary(session)}`,
    ...(session.outcome === 'abandoned' ? [`Posledný krok: ${session.step}`] : []),
    ...(session.answers.length ? [`Prepis odpovedí: ${session.answers.map(answer => `${answer.step}: ${answer.text}`).join(' | ')}`] : []),
  ].join('\n');
}

function buildEvent(session: NimalaSession): VoicemailRecordedEvent {
  const endedAt = session.endedAt || new Date().toISOString();
  return {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: nimalaBotConfig.clinic.routingPhoneNumber,
    durationSeconds: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000)),
    callStartedAt: session.startedAt,
    callEndedAt: endedAt,
    providerCallId: session.callSid,
    nameUrl: '',
    birthYearUrl: '',
    problemUrl: '',
    nameTranscript: session.patientName || '',
    birthYearTranscript: session.birthYear || '',
    problemTranscript: buildProblemTranscript(session),
  };
}

function hasMeaningfulRequest(session: NimalaSession): boolean {
  return Boolean(session.requestType || session.appointmentType || session.detail || session.selectedSlot);
}

function dispatchRequest(fastify: FastifyInstance, session: NimalaSession, onSuccess?: () => void): boolean {
  if (!hasMeaningfulRequest(session)) return false;
  const eventKey = createVoiceEventKey('voicemail_recorded', session.callSid);
  if (!claimVoiceEvent(eventKey)) return false;
  prixiService.sendEvent(buildEvent(session), 3, eventKey)
    .then(() => {
      completeVoiceEvent(eventKey);
      onSuccess?.();
    })
    .catch(error => {
      failVoiceEvent(eventKey);
      fastify.log.error(error, 'Failed to create Nimala PriXi request');
    });
  return true;
}

async function completeRequest(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession
): Promise<FastifyReply> {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  dispatchRequest(fastify, session);
  nimalaSessionService.delete(session.callSid);
  const message = session.requestType === 'prescription' ? copy.prescriptionComplete : copy.resultsComplete;
  return renderEnd(reply, message);
}

async function callbackFallback(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession,
  message: NimalaSpokenResponse
): Promise<FastifyReply> {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  if (!session.requestType) session.requestType = 'human';
  dispatchRequest(fastify, session);
  nimalaSessionService.delete(session.callSid);
  return renderEnd(reply, message);
}

async function handoffToHuman(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession
): Promise<FastifyReply> {
  const destination = humanDestination();
  session.requestType = session.requestType || 'human';
  session.outcome = 'handoff';
  session.endedAt = new Date().toISOString();
  if (!destination) {
    return callbackFallback(
      fastify,
      reply,
      session,
      copy.transferUnavailable
    );
  }
  nimalaSessionService.save(session);
  const twiml = new VoiceResponse();
  await appendSpoken(twiml, reply.request, copy.transferStart);
  const dial = twiml.dial({
    action: '/voice/nimala/handoff-complete',
    method: 'POST',
    timeout: 25,
    callerId: nimalaBotConfig.clinic.inboundTwilioNumber,
  } as any);
  dial.number(destination);
  return reply.type('text/xml').send(twiml.toString());
}

async function retryOrHandoff(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NimalaSession
): Promise<FastifyReply> {
  session.attempts += 1;
  if (session.attempts >= 2) return handoffToHuman(fastify, reply, session);
  return renderPrompt(reply, session, copy.retry);
}

function bookingPayload(session: NimalaSession): CreatePrixiBookingInput {
  if (!session.selectedSlot || !session.eventTypeUid || !session.firstName || !session.lastName) {
    throw new Error('Incomplete Nimala booking session');
  }
  session.bookingIdempotencyKey = session.bookingIdempotencyKey || uuidv4();
  return {
    clinicId: Number(session.clinicId),
    calendarId: session.selectedSlot.calendarId,
    eventTypeUid: session.eventTypeUid,
    startAt: session.selectedSlot.startAt,
    patient: { name: session.firstName, surname: session.lastName, phone_number: session.phone },
    metadata: { source: 'voice_bot', externalReference: session.callSid },
    idempotencyKey: session.bookingIdempotencyKey,
  };
}

async function confirmBooking(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession): Promise<FastifyReply> {
  const payload = bookingPayload(session);
  let result = await prixiCalendarService.createBooking(payload);
  if (result.status === 'uncertain') {
    result = await prixiCalendarService.createBooking(payload);
  }
  if (result.status === 'created') {
    session.bookingStatus = 'created';
    session.outcome = 'booked';
    session.endedAt = new Date().toISOString();
    const doctor = session.selectedSlot!.calendarName || 'MUDr. Dávid Anovčin';
    const message = dynamicSpoken(`Termín ${formatNimalaSlotForSpeech(session.selectedSlot!)} na ${appointmentLabels[session.appointmentType!]} u lekára ${doctor} je úspešne rezervovaný. ${copy.farewell.text}`);
    nimalaSessionService.delete(session.callSid);
    return renderEnd(reply, message);
  }
  if (result.status === 'slot_unavailable') {
    session.bookingStatus = 'slot_unavailable';
    const hasSlots = await loadAvailableSlots(session);
    if (hasSlots) {
      session.step = 'slot';
      session.attempts = 0;
      return renderPrompt(reply, session, copy.slotBecameUnavailable);
    }
  }
  if (result.status === 'uncertain') session.bookingStatus = 'uncertain';
  else if (result.status !== 'slot_unavailable') session.bookingStatus = 'failed';
  fastify.log.warn({
    callSid: session.callSid,
    bookingStatus: result.status,
    httpStatus: 'httpStatus' in result ? result.httpStatus : undefined,
    apiCode: 'code' in result ? result.code : undefined,
    apiMessage: 'message' in result ? result.message : undefined,
    validationFields: 'validationFields' in result ? result.validationFields : undefined,
    validationDetails: 'validationDetails' in result ? result.validationDetails : undefined,
    diagnostic: 'diagnostic' in result ? result.diagnostic : undefined,
  }, 'Nimala Calendar booking was not confirmed');
  return callbackFallback(
    fastify,
    reply,
    session,
    result.status === 'uncertain' ? copy.bookingStatusUncertain : copy.bookingFailed
  );
}

async function confirmReschedule(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession): Promise<FastifyReply> {
  if (!session.selectedBooking || !session.selectedSlot || !session.patientVerificationToken) {
    throw new Error('Incomplete Nimala reschedule session');
  }
  session.managementIdempotencyKey = session.managementIdempotencyKey || uuidv4();
  const input = {
    bookingId: session.selectedBooking.id,
    clinicId: Number(session.clinicId),
    calendarId: session.selectedSlot.calendarId,
    eventTypeUid: session.selectedBooking.eventTypeUid,
    startAt: session.selectedSlot.startAt,
    verificationToken: session.patientVerificationToken,
    idempotencyKey: session.managementIdempotencyKey,
  };
  let result = await prixiCalendarService.rescheduleBooking(input);
  if (result.status === 'uncertain') result = await prixiCalendarService.rescheduleBooking(input);
  if (result.status === 'rescheduled') {
    session.managementStatus = 'rescheduled';
    session.outcome = 'rescheduled';
    session.endedAt = new Date().toISOString();
    const doctor = result.booking.calendarName || session.selectedSlot.calendarName || 'ambulancie';
    const emailMessage = result.emailNotification === 'sent'
      ? ' Potvrdenie sme vám poslali e-mailom.'
      : '';
    const message = dynamicSpoken(`Termín na ${managedBookingName(session.selectedBooking)} bol úspešne zmenený na ${formatNimalaSlotForSpeech(result.booking)}, u lekára ${doctor}.${emailMessage} ${copy.farewell.text}`);
    nimalaSessionService.delete(session.callSid);
    return renderEnd(reply, message);
  }
  if (result.status === 'slot_unavailable') {
    session.managementStatus = 'slot_unavailable';
    const hasSlots = await loadRescheduleSlots(session);
    if (hasSlots) {
      session.step = 'reschedule_slot';
      session.attempts = 0;
      session.managementIdempotencyKey = undefined;
      return renderPrompt(reply, session, copy.slotBecameUnavailable);
    }
  }
  session.managementStatus = result.status === 'uncertain' ? 'uncertain' : 'failed';
  fastify.log.warn({
    callSid: session.callSid,
    managementOperation: 'reschedule',
    managementStatus: result.status,
    httpStatus: 'httpStatus' in result ? result.httpStatus : undefined,
    apiCode: 'code' in result ? result.code : undefined,
  }, 'Nimala booking reschedule was not confirmed');
  return callbackFallback(fastify, reply, session, copy.managementFailed);
}

async function confirmCancellation(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession): Promise<FastifyReply> {
  if (!session.selectedBooking || !session.patientVerificationToken) {
    throw new Error('Incomplete Nimala cancellation session');
  }
  session.managementIdempotencyKey = session.managementIdempotencyKey || uuidv4();
  const input = {
    bookingId: session.selectedBooking.id,
    clinicId: Number(session.clinicId),
    verificationToken: session.patientVerificationToken,
    idempotencyKey: session.managementIdempotencyKey,
  };
  let result = await prixiCalendarService.cancelBooking(input);
  if (result.status === 'uncertain') result = await prixiCalendarService.cancelBooking(input);
  if (result.status === 'cancelled' || result.status === 'already_cancelled') {
    session.managementStatus = 'cancelled';
    session.outcome = 'cancelled';
    session.endedAt = new Date().toISOString();
    const message = dynamicSpoken(`Rezervácia na ${managedBookingName(session.selectedBooking)}, ${formatNimalaSlotForSpeech(session.selectedBooking)}, bola úspešne zrušená. ${copy.farewell.text}`);
    nimalaSessionService.delete(session.callSid);
    return renderEnd(reply, message);
  }
  session.managementStatus = result.status === 'uncertain' ? 'uncertain' : 'failed';
  fastify.log.warn({
    callSid: session.callSid,
    managementOperation: 'cancel',
    managementStatus: result.status,
    httpStatus: 'httpStatus' in result ? result.httpStatus : undefined,
    apiCode: 'code' in result ? result.code : undefined,
  }, 'Nimala booking cancellation was not confirmed');
  return callbackFallback(fastify, reply, session, copy.managementFailed);
}

export async function startNimalaVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const clinicId = await resolveClinicId();
    return renderPrompt(reply, nimalaSessionService.create(body.CallSid, body.From || '', clinicId));
  } catch (error) {
    fastify.log.error(error, 'Nimala clinic routing validation failed');
    return renderEnd(reply, copy.startupTechnical);
  }
}

export function finalizeAbandonedNimalaCall(
  fastify: FastifyInstance,
  callSid: string,
  endedAt: string = new Date().toISOString()
): boolean {
  const session = nimalaSessionService.get(callSid);
  if (!session) return false;
  if (!hasMeaningfulRequest(session) || ['booked', 'rescheduled', 'cancelled'].includes(session.outcome || '')) {
    nimalaSessionService.delete(callSid);
    return false;
  }
  session.outcome = 'abandoned';
  session.endedAt = endedAt;
  nimalaSessionService.save(session);
  return dispatchRequest(fastify, session, () => nimalaSessionService.delete(callSid));
}

export async function nimalaVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/nimala/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = nimalaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    return retryOrHandoff(fastify, reply, session);
  });

  fastify.post('/nimala/handoff-complete', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = nimalaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.farewell);
    if (body.DialCallStatus === 'completed') {
      nimalaSessionService.delete(session.callSid);
      return renderEnd(reply, copy.transferComplete);
    }
    return callbackFallback(
      fastify,
      reply,
      session,
      copy.transferNotAnswered
    );
  });

  fastify.post('/nimala/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = nimalaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) return retryOrHandoff(fastify, reply, session);
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'intent') {
      const department = parseNimalaDepartment(answer);
      if (department && department !== 'urology') {
        nimalaSessionService.delete(session.callSid);
        return renderEnd(reply, unsupportedDepartmentMessage(department));
      }

      const requestType = parseNimalaMainMenu(answer);
      if (!requestType) {
        if (department === 'urology') {
          session.attempts = 0;
          session.step = 'main_menu';
          return renderPrompt(reply, session);
        }
        return retryOrHandoff(fastify, reply, session);
      }

      return continueWithRequestType(fastify, reply, session, requestType, answer);
    }

    if (session.step === 'main_menu') {
      const requestType = parseNimalaMainMenu(answer);
      if (!requestType) return retryOrHandoff(fastify, reply, session);
      return continueWithRequestType(fastify, reply, session, requestType);
    }

    if (session.step === 'appointment_type') {
      const appointmentType = parseNimalaAppointmentType(answer);
      if (!appointmentType) return retryOrHandoff(fastify, reply, session);
      return continueWithAppointmentType(fastify, reply, session, appointmentType);
    }

    if (session.step === 'existing_booking') {
      const index = parseNimalaChoice(answer, session.offeredBookings?.length || 0);
      if (index === undefined) return retryOrHandoff(fastify, reply, session);
      return continueWithManagedBooking(fastify, reply, session, session.offeredBookings![index]);
    }

    if (session.step === 'reschedule_slot') {
      if (isNimalaRepeatSlotsRequest(answer)) {
        session.attempts = 0;
        return renderPrompt(reply, session);
      }
      const index = parseNimalaSlotChoice(answer, session.offeredSlots || []);
      if (index === undefined) return retryOrHandoff(fastify, reply, session);
      session.selectedSlot = session.offeredSlots![index];
      session.attempts = 0;
      session.managementIdempotencyKey = undefined;
      session.step = 'reschedule_confirmation';
      return renderPrompt(reply, session);
    }

    if (session.step === 'reschedule_confirmation') {
      if (isNimalaRepeatSlotsRequest(answer)) {
        session.step = 'reschedule_slot';
        session.selectedSlot = undefined;
        session.managementIdempotencyKey = undefined;
        session.attempts = 0;
        return renderPrompt(reply, session);
      }
      const confirmed = parseNimalaYesNo(answer);
      if (confirmed === undefined) return retryOrHandoff(fastify, reply, session);
      session.attempts = 0;
      if (!confirmed) {
        session.step = 'reschedule_slot';
        session.selectedSlot = undefined;
        session.managementIdempotencyKey = undefined;
        return renderPrompt(reply, session, copy.selectDifferentSlot);
      }
      try {
        return await confirmReschedule(fastify, reply, session);
      } catch (error) {
        session.managementStatus = 'failed';
        fastify.log.error(error, 'Failed to reschedule Nimala booking');
        return callbackFallback(fastify, reply, session, copy.managementFailed);
      }
    }

    if (session.step === 'cancel_confirmation') {
      const confirmed = parseNimalaYesNo(answer);
      if (confirmed === undefined) return retryOrHandoff(fastify, reply, session);
      session.attempts = 0;
      if (!confirmed) {
        nimalaSessionService.delete(session.callSid);
        return renderEnd(reply, copy.cancellationDeclined);
      }
      try {
        return await confirmCancellation(fastify, reply, session);
      } catch (error) {
        session.managementStatus = 'failed';
        fastify.log.error(error, 'Failed to cancel Nimala booking');
        return callbackFallback(fastify, reply, session, copy.managementFailed);
      }
    }

    if (session.step === 'slot') {
      if (isNimalaRepeatSlotsRequest(answer)) {
        session.attempts = 0;
        return renderPrompt(reply, session);
      }
      const index = parseNimalaSlotChoice(answer, session.offeredSlots || []);
      if (index === undefined) return retryOrHandoff(fastify, reply, session);
      session.selectedSlot = session.offeredSlots![index];
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'name') {
      const name = parseNimalaName(answer);
      if (!name) return retryOrHandoff(fastify, reply, session);
      session.firstName = name.firstName;
      session.lastName = name.lastName;
      session.patientName = name.fullName;
      session.attempts = 0;
      session.step = session.requestType === 'appointment' ? 'booking_confirmation' : 'birth_year';
      return renderPrompt(reply, session);
    }

    if (session.step === 'birth_year') {
      const birthYear = parseNimalaBirthYear(answer);
      if (!birthYear) return retryOrHandoff(fastify, reply, session);
      session.birthYear = birthYear;
      session.attempts = 0;
      session.step = 'detail';
      return renderPrompt(reply, session);
    }

    if (session.step === 'detail') {
      session.detail = answer;
      return completeRequest(fastify, reply, session);
    }

    if (session.step === 'booking_confirmation') {
      if (isNimalaRepeatSlotsRequest(answer)) {
        session.step = 'slot';
        session.selectedSlot = undefined;
        session.bookingIdempotencyKey = undefined;
        session.attempts = 0;
        return renderPrompt(reply, session);
      }
      const confirmed = parseNimalaYesNo(answer);
      if (confirmed === undefined) return retryOrHandoff(fastify, reply, session);
      session.attempts = 0;
      if (!confirmed) {
        session.step = 'slot';
        session.selectedSlot = undefined;
        session.bookingIdempotencyKey = undefined;
        return renderPrompt(reply, session, copy.selectDifferentSlot);
      }
      try {
        return await confirmBooking(fastify, reply, session);
      } catch (error) {
        session.bookingStatus = 'failed';
        fastify.log.error(error, 'Failed to create Nimala booking');
        return callbackFallback(fastify, reply, session, copy.technical);
      }
    }

    return retryOrHandoff(fastify, reply, session);
  });
}

