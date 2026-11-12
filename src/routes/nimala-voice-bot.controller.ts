import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import twilio from 'twilio';
import { v4 as uuidv4 } from 'uuid';
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
  parseNimalaSlotChoice,
  parseNimalaYesNo,
  normalizeNimalaSpeech,
  NimalaDepartment,
} from '../services/nimala-nlu.service';
import { NimalaSession, nimalaSessionService } from '../services/nimala-session.service';
import {
  CreatePrixiBookingInput,
  PrixiCalendarService,
  PrixiCalendarSlot,
  prixiCalendarService,
} from '../services/prixi-calendar.service';
import { prixiService } from '../services/prixi.service';
import { VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, createVoiceEventKey, failVoiceEvent } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

const copy = {
  greeting: 'Dobrý deň, dovolali ste sa do kliniky Nimala. Vyberte si, prosím, ambulanciu. Pre urológiu stlačte jednotku. Pre estetiku dvojku. Pre sonografiu trojku. Pre proktológiu štvorku. Pre dermatológiu päťku. Táto demo verzia je zatiaľ aktívna iba pre urologickú ambulanciu pána doktora Dávida Anovčina.',
  urologyMenu: 'Ak ide o náhly život ohrozujúci stav, volajte tiesňovú linku 155 alebo 112. Ak sa chcete objednať na urologické vyšetrenie, stlačte jednotku. Pre e-recept stlačte dvojku. Pre informácie o výsledkoch urologického vyšetrenia stlačte trojku. Ak chcete hovoriť s človekom, stlačte nulu.',
  appointmentType: 'Vyberte si typ vyšetrenia. Pre VIP termín urológia stlačte jednotku. Pre preventívnu prehliadku dvojku. Pre konzultáciu trojku. Pre kontrolu po operácii štvorku. Pre konzultáciu k operácii prostaty vodnou parou päťku. Pre U F M stlačte šestku.',
  name: 'Povedzte, prosím, svoje meno a priezvisko.',
  birthYear: 'Povedzte, prosím, svoj rok narodenia.',
  prescriptionDetail: 'Povedzte, prosím, názov lieku, jeho silu a počet balení.',
  resultsDetail: 'Povedzte, prosím, o aké výsledky ide a približný dátum vyšetrenia.',
  retry: 'Prepáčte, nerozumela som. Skúste to, prosím, ešte raz. ',
  expired: 'Hovor sa nepodarilo dokončiť. Zavolajte, prosím, znova. Dovidenia.',
  technical: 'Momentálne sa neviem bezpečne spojiť s rezervačným systémom. Vašu požiadavku odovzdám personálu kliniky. Dovidenia.',
  startupTechnical: 'Momentálne máme technické problémy. Skúste, prosím, zavolať neskôr. Dovidenia.',
};

const requestLabels: Record<NimalaRequestType, string> = {
  appointment: 'objednanie na vyšetrenie',
  prescription: 'žiadosť o e-recept',
  results: 'informácie o výsledkoch vyšetrenia',
  human: 'žiadosť o spojenie s človekom',
};

const appointmentLabels: Record<NimalaAppointmentType, string> = Object.fromEntries(
  Object.entries(nimalaBotConfig.booking.services).map(([key, service]) => [key, service.label])
) as Record<NimalaAppointmentType, string>;

const departmentLabels: Record<Exclude<NimalaDepartment, 'urology'>, string> = {
  aesthetics: 'estetika',
  ultrasound: 'sonografia',
  proctology: 'proktológia',
  dermatology: 'dermatológia',
};

function unsupportedDepartmentMessage(department: Exclude<NimalaDepartment, 'urology'>): string {
  return `Ďakujem. Vybrali ste odbor ${departmentLabels[department]}. Táto ambulancia zatiaľ nie je v demo verzii hlasovej asistentky aktívna. Momentálne môžete pokračovať iba s urologickou ambulanciou. Ďakujeme za pochopenie a dovidenia.`;
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

function slotOffer(session: NimalaSession): string {
  const slots = session.offeredSlots || [];
  if (!slots.length) return 'Momentálne som nenašla žiadny voľný termín.';
  return `Mám pre vás tieto voľné termíny. ${slots.map((slot, index) => `Možnosť ${index + 1}: ${formatSlot(slot)}.`).join(' ')} Povedzte číslo možnosti alebo ho stlačte na klávesnici.`;
}

function bookingConfirmation(session: NimalaSession): string {
  const service = session.appointmentType ? appointmentLabels[session.appointmentType] : 'vyšetrenie';
  const slot = session.selectedSlot ? formatSlot(session.selectedSlot) : 'vybraný termín';
  const doctor = session.selectedSlot?.calendarName || 'MUDr. Dávid Anovčin';
  const duration = session.selectedSlot?.durationMinutes
    || (session.appointmentType ? serviceDefinition(session.appointmentType).durationMinutes : undefined);
  return `Prosím potvrďte rezerváciu: ${service}${duration ? ` v trvaní ${duration} minút` : ''}, ${slot}, u lekára ${doctor}, pre pacienta ${session.patientName}. Ak sú údaje správne, povedzte áno alebo stlačte jednotku. Ak chcete vybrať iný termín, povedzte nie alebo stlačte dvojku.`;
}

function promptFor(session: NimalaSession): string {
  switch (session.step) {
    case 'department': return copy.greeting;
    case 'main_menu': return copy.urologyMenu;
    case 'appointment_type': return copy.appointmentType;
    case 'slot': return slotOffer(session);
    case 'name': return copy.name;
    case 'birth_year': return copy.birthYear;
    case 'detail': return session.requestType === 'prescription' ? copy.prescriptionDetail : copy.resultsDetail;
    case 'booking_confirmation': return bookingConfirmation(session);
  }
}

function renderPrompt(reply: FastifyReply, session: NimalaSession, prefix = ''): FastifyReply {
  nimalaSessionService.save(session);
  const twiml = new VoiceResponse();
  const menuStep = ['department', 'main_menu', 'appointment_type', 'slot', 'booking_confirmation'].includes(session.step);
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/nimala/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    ...(menuStep ? { numDigits: 1 } : {}),
  } as any);
  gather.say(sayOptions, `${prefix}${promptFor(session)}`.trim());
  twiml.redirect('/voice/nimala/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderEnd(reply: FastifyReply, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, message);
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

function requestSummary(session: NimalaSession): string {
  if (session.requestType === 'prescription') return `Pacient žiada e-recept: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'results') return `Pacient žiada informácie o výsledkoch: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'human') return 'Pacient žiada telefonický kontakt s človekom.';
  const service = session.appointmentType ? appointmentLabels[session.appointmentType] : 'nezistený typ vyšetrenia';
  const slot = session.selectedSlot ? formatSlot(session.selectedSlot) : 'termín nebol vybraný';
  return `Pacient žiada objednanie na ${service}; ${slot}. Rezervácia nebola potvrdená Calendar API.`;
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

function completeRequest(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession): FastifyReply {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  dispatchRequest(fastify, session);
  nimalaSessionService.delete(session.callSid);
  const message = session.requestType === 'prescription'
    ? 'Ďakujem. Požiadavku na e-recept sme zaznamenali. Klinika ju po overení spracuje a bude vás informovať. Dovidenia.'
    : 'Ďakujem. Požiadavku na informácie o výsledkoch sme zaznamenali. Klinika vás bude kontaktovať. Dovidenia.';
  return renderEnd(reply, message);
}

function callbackFallback(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession, message: string): FastifyReply {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  if (!session.requestType) session.requestType = 'human';
  dispatchRequest(fastify, session);
  nimalaSessionService.delete(session.callSid);
  return renderEnd(reply, message);
}

function handoffToHuman(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession): FastifyReply {
  const destination = humanDestination();
  session.requestType = session.requestType || 'human';
  session.outcome = 'handoff';
  session.endedAt = new Date().toISOString();
  if (!destination) {
    return callbackFallback(
      fastify,
      reply,
      session,
      'Momentálne vás neviem bezpečne prepojiť. Vašu žiadosť o telefonický kontakt som odovzdala klinike. Dovidenia.'
    );
  }
  nimalaSessionService.save(session);
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, 'Rozumiem. Prepájam vás na pracovníka kliniky. Prosím, zostaňte na linke.');
  const dial = twiml.dial({
    action: '/voice/nimala/handoff-complete',
    method: 'POST',
    timeout: 25,
    callerId: nimalaBotConfig.clinic.inboundTwilioNumber,
  } as any);
  dial.number(destination);
  return reply.type('text/xml').send(twiml.toString());
}

function retryOrHandoff(fastify: FastifyInstance, reply: FastifyReply, session: NimalaSession): FastifyReply {
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
    session.outcome = 'booked';
    session.endedAt = new Date().toISOString();
    const doctor = session.selectedSlot!.calendarName || 'MUDr. Dávid Anovčin';
    const message = `Ďakujem. Termín ${formatSlot(session.selectedSlot!)} na ${appointmentLabels[session.appointmentType!]} u lekára ${doctor} je úspešne rezervovaný. Dovidenia.`;
    nimalaSessionService.delete(session.callSid);
    return renderEnd(reply, message);
  }
  if (result.status === 'slot_unavailable') {
    const hasSlots = await loadAvailableSlots(session);
    if (hasSlots) {
      session.step = 'slot';
      session.attempts = 0;
      return renderPrompt(reply, session, 'Tento termín sa medzitým obsadil. Pozrime sa na ďalšie voľné možnosti. ');
    }
  }
  return callbackFallback(
    fastify,
    reply,
    session,
    result.status === 'uncertain'
      ? 'Výsledok rezervácie sa mi nepodarilo spoľahlivo overiť. Aby nevznikla duplicitná rezervácia, požiadavku preverí personál kliniky a bude vás kontaktovať. Dovidenia.'
      : copy.technical
  );
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
  if (!hasMeaningfulRequest(session) || session.outcome === 'booked') {
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
    if (!session) return renderEnd(reply, 'Dovidenia.');
    if (body.DialCallStatus === 'completed') {
      nimalaSessionService.delete(session.callSid);
      return renderEnd(reply, 'Ďakujeme za zavolanie. Dovidenia.');
    }
    return callbackFallback(
      fastify,
      reply,
      session,
      'Pracovníka kliniky sa teraz nepodarilo zastihnúť. Vašu žiadosť o telefonický kontakt sme zaznamenali. Dovidenia.'
    );
  });

  fastify.post('/nimala/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = nimalaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) return retryOrHandoff(fastify, reply, session);
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'department') {
      const department = parseNimalaDepartment(answer);
      if (!department) return retryOrHandoff(fastify, reply, session);
      session.attempts = 0;
      if (department !== 'urology') {
        nimalaSessionService.delete(session.callSid);
        return renderEnd(reply, unsupportedDepartmentMessage(department));
      }
      session.step = 'main_menu';
      return renderPrompt(reply, session);
    }

    if (session.step === 'main_menu') {
      const requestType = parseNimalaMainMenu(answer);
      if (!requestType) return retryOrHandoff(fastify, reply, session);
      session.requestType = requestType;
      session.attempts = 0;
      if (requestType === 'human') return handoffToHuman(fastify, reply, session);
      session.step = requestType === 'appointment' ? 'appointment_type' : 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'appointment_type') {
      const appointmentType = parseNimalaAppointmentType(answer);
      if (!appointmentType) return retryOrHandoff(fastify, reply, session);
      session.appointmentType = appointmentType;
      session.attempts = 0;
      try {
        const hasSlots = await loadAvailableSlots(session);
        if (!hasSlots) {
          return callbackFallback(fastify, reply, session, 'Pre tento typ vyšetrenia momentálne nevidím voľný termín. Vašu požiadavku odovzdám klinike, ktorá vás bude kontaktovať. Dovidenia.');
        }
        session.step = 'slot';
        return renderPrompt(reply, session);
      } catch (error) {
        fastify.log.error(error, 'Failed to load Nimala availability');
        return callbackFallback(fastify, reply, session, copy.technical);
      }
    }

    if (session.step === 'slot') {
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
      const confirmed = parseNimalaYesNo(answer);
      if (confirmed === undefined) return retryOrHandoff(fastify, reply, session);
      session.attempts = 0;
      if (!confirmed) {
        session.step = 'slot';
        session.selectedSlot = undefined;
        session.bookingIdempotencyKey = undefined;
        return renderPrompt(reply, session, 'Rozumiem. Vyberte si, prosím, iný termín. ');
      }
      try {
        return await confirmBooking(fastify, reply, session);
      } catch (error) {
        fastify.log.error(error, 'Failed to create Nimala booking');
        return callbackFallback(fastify, reply, session, copy.technical);
      }
    }

    return retryOrHandoff(fastify, reply, session);
  });
}

