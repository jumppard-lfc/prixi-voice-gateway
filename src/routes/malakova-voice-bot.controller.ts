import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import {
  malakovaBotConfig,
  MalakovaAppointmentType,
  MalakovaRequestType,
} from '../config/malakova.config';
import {
  parseMalakovaAppointmentType,
  parseMalakovaMainMenu,
} from '../services/malakova-nlu.service';
import { MalakovaSession, malakovaSessionService } from '../services/malakova-session.service';
import { prixiService } from '../services/prixi.service';
import { VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, createVoiceEventKey, failVoiceEvent } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

const copy = {
  greeting: 'Dobrý deň, dovolali ste sa do ambulancie pani doktorky Malákovej. Potrebujete sa objednať na vyšetrenie, požiadať o recept alebo sa spojiť s ambulanciou? Pre objednanie stlačte jednotku, pre recept dvojku a pre kontakt s ambulanciou trojku.',
  appointmentType: 'O aký typ návštevy ide? Pre zdravotné ťažkosti stlačte jednotku. Pre potvrdenie dvojku. Pre predoperačné vyšetrenie trojku. Pre preventívnu prehliadku štvorku. Pre iný dôvod päťku.',
  name: 'Prosím, povedzte svoje meno a priezvisko.',
  prescriptionDetail: 'Aký liek potrebujete predpísať na recept?',
  retry: 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz. ',
  expired: 'Hovor sa nepodarilo dokončiť. Zavolajte, prosím, znova. Dovidenia.',
  technical: 'Momentálne máme technické problémy. Skúste, prosím, zavolať neskôr. Dovidenia.',
};

const requestLabels: Record<MalakovaRequestType, string> = {
  appointment: 'objednanie na vyšetrenie',
  prescription: 'žiadosť o recept',
  contact: 'žiadosť o telefonický kontakt',
};

const appointmentLabels: Record<MalakovaAppointmentType, string> = {
  health_problem: 'zdravotné ťažkosti',
  certificate: 'potvrdenie',
  preoperative_exam: 'predoperačné vyšetrenie',
  preventive_exam: 'preventívna prehliadka',
  other: 'iný dôvod návštevy',
};

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function promptFor(session: MalakovaSession): string {
  if (session.step === 'main_menu') return copy.greeting;
  if (session.step === 'appointment_type') return copy.appointmentType;
  if (session.step === 'prescription_detail') return copy.prescriptionDetail;
  return copy.name;
}

function renderPrompt(reply: FastifyReply, session: MalakovaSession, prefix = ''): FastifyReply {
  malakovaSessionService.save(session);
  const twiml = new VoiceResponse();
  const isMenu = session.step === 'main_menu' || session.step === 'appointment_type';
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/malakova/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    ...(isMenu ? { numDigits: 1 } : {}),
  } as any);
  gather.say(sayOptions, `${prefix}${promptFor(session)}`.trim());
  twiml.redirect('/voice/malakova/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderEnd(reply: FastifyReply, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

async function resolveClinicId(): Promise<string> {
  const config = await prixiService.getConfig(malakovaBotConfig.clinic.inboundTwilioNumber);
  const clinicId = String(config.clinicId ?? '').trim();
  if (config.voiceBotEnabled !== true || clinicId !== malakovaBotConfig.clinic.clinicId) {
    throw new Error(`Blocked Malakova route: expected clinic 161, received ${clinicId || '<missing>'}`);
  }
  return clinicId;
}

function appointmentDuration(session: MalakovaSession): number | undefined {
  if (session.appointmentType === 'health_problem') return malakovaBotConfig.booking.durationsMinutes.health_problem;
  if (session.appointmentType === 'certificate') return malakovaBotConfig.booking.durationsMinutes.certificate;
  return undefined;
}

function requestSummary(session: MalakovaSession): string {
  if (session.requestType === 'appointment') {
    const type = session.appointmentType ? appointmentLabels[session.appointmentType] : 'nezistený typ vyšetrenia';
    const duration = appointmentDuration(session);
    return `Pacient žiada termín: ${type}${duration ? `, požadovaná dĺžka ${duration} minút` : ''}. Konkrétny termín nebol rezervovaný; ambulancia má pacienta kontaktovať.`;
  }
  if (session.requestType === 'prescription') {
    return `Požiadavka na recept: ${session.detail || 'liek nebol uvedený'}.`;
  }
  return 'Pacient žiada telefonický kontakt s ambulanciou.';
}

function buildProblemTranscript(session: MalakovaSession): string {
  return [
    '[Voice-bot ambulancia MUDr. Malákovej]',
    `Stav hovoru: ${session.outcome === 'abandoned' ? 'NEDOKONČENÝ – volajúci zložil pred ukončením flow' : 'dokončený'}`,
    `Kategória: ${session.requestType ? requestLabels[session.requestType] : 'nezistená'}`,
    ...(session.appointmentType ? [`Typ návštevy: ${appointmentLabels[session.appointmentType]}`] : []),
    ...(appointmentDuration(session) ? [`Požadovaná dĺžka termínu: ${appointmentDuration(session)} minút`] : []),
    `Telefón: ${session.phone}`,
    `Meno a priezvisko: ${session.patientName || 'neuvedené'}`,
    `**Zhrnutie:** ${requestSummary(session)}`,
    ...(session.outcome === 'abandoned' ? [`Posledný krok: ${session.step}`] : []),
    ...(session.answers.length ? [`Prepis odpovedí: ${session.answers.map(answer => `${answer.step}: ${answer.text}`).join(' | ')}`] : []),
  ].join('\n');
}

function closingMessage(session: MalakovaSession): string {
  if (session.requestType === 'prescription') {
    return 'Ambulancia eviduje vašu žiadosť o vystavenie receptu. Po posúdení lekárkou vám bude recept vystavený elektronicky. Ďakujeme za zavolanie. Prajeme vám pekný deň.';
  }
  if (session.requestType === 'contact') {
    return 'Ambulancia eviduje vašu žiadosť o telefonický kontakt. Budeme vás kontaktovať v najbližšom možnom čase. Ďakujeme za zavolanie. Prajeme vám pekný deň.';
  }
  return 'Ambulancia eviduje vašu žiadosť o termín. Budeme vás kontaktovať s ponukou termínu v najbližšom možnom čase. Konkrétny termín zatiaľ nebol rezervovaný. Ďakujeme za zavolanie.';
}

function hasMeaningfulRequest(session: MalakovaSession): boolean {
  return Boolean(session.requestType || session.appointmentType || session.detail);
}

function buildEvent(session: MalakovaSession): VoicemailRecordedEvent {
  const endedAt = session.endedAt || new Date().toISOString();
  return {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: malakovaBotConfig.clinic.routingPhoneNumber,
    durationSeconds: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000)),
    callStartedAt: session.startedAt,
    callEndedAt: endedAt,
    providerCallId: session.callSid,
    nameUrl: '',
    birthYearUrl: '',
    problemUrl: '',
    nameTranscript: session.patientName || '',
    birthYearTranscript: '',
    problemTranscript: buildProblemTranscript(session),
  };
}

function dispatchRequest(fastify: FastifyInstance, session: MalakovaSession, onSuccess?: () => void): boolean {
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
      fastify.log.error(error, 'Failed to create MUDr. Malakova PriXi request');
    });
  return true;
}

function completeCall(fastify: FastifyInstance, reply: FastifyReply, session: MalakovaSession): FastifyReply {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  dispatchRequest(fastify, session);
  malakovaSessionService.delete(session.callSid);
  return renderEnd(reply, closingMessage(session));
}

export async function startMalakovaVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const clinicId = await resolveClinicId();
    return renderPrompt(reply, malakovaSessionService.create(body.CallSid, body.From || '', clinicId));
  } catch (error) {
    fastify.log.error(error, 'MUDr. Malakova clinic routing validation failed');
    return renderEnd(reply, copy.technical);
  }
}

export function finalizeAbandonedMalakovaCall(
  fastify: FastifyInstance,
  callSid: string,
  endedAt: string = new Date().toISOString()
): boolean {
  const session = malakovaSessionService.get(callSid);
  if (!session) return false;
  if (!hasMeaningfulRequest(session)) {
    malakovaSessionService.delete(callSid);
    return false;
  }
  session.outcome = 'abandoned';
  session.endedAt = endedAt;
  malakovaSessionService.save(session);
  return dispatchRequest(fastify, session, () => malakovaSessionService.delete(callSid));
}

export async function malakovaVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/malakova/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = malakovaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    session.attempts += 1;
    if (session.attempts >= 3) {
      finalizeAbandonedMalakovaCall(fastify, session.callSid);
      return renderEnd(reply, copy.expired);
    }
    return renderPrompt(reply, session, copy.retry);
  });

  fastify.post('/malakova/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = malakovaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, copy.retry);
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'main_menu') {
      const requestType = parseMalakovaMainMenu(answer);
      if (!requestType) return renderPrompt(reply, session, copy.retry);
      session.requestType = requestType;
      session.attempts = 0;
      session.step = requestType === 'appointment' ? 'appointment_type' : 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'appointment_type') {
      const appointmentType = parseMalakovaAppointmentType(answer);
      if (!appointmentType) return renderPrompt(reply, session, copy.retry);
      session.appointmentType = appointmentType;
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'name') {
      session.patientName = answer;
      session.attempts = 0;
      if (session.requestType === 'prescription') {
        session.step = 'prescription_detail';
        return renderPrompt(reply, session);
      }
      return completeCall(fastify, reply, session);
    }

    if (session.step === 'prescription_detail') {
      session.detail = answer;
      return completeCall(fastify, reply, session);
    }

    return renderPrompt(reply, session, copy.retry);
  });
}
