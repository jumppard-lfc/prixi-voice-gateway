import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import twilio from 'twilio';
import { NeurocentrumRequestType } from '../config/neurocentrum.config';
import { neurocentrumEdsService, NeurocentrumPatientRequestEvent } from '../services/neurocentrum-eds.service';
import {
  isNeurocentrumUrgent,
  normalizeNeurocentrumDateOfBirth,
  parseNeurocentrumRequestType,
  parseNeurocentrumYesNo,
} from '../services/neurocentrum-nlu.service';
import { NeurocentrumSession, neurocentrumSessionService } from '../services/neurocentrum-session.service';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: Record<string, any> = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };
const NO_CONFIG_MESSAGE = 'Momentálne máme technický problém a vašu požiadavku nevieme bezpečne zaznamenať. Skúste, prosím, zavolať neskôr.';

const requestTypeLabels: Record<NeurocentrumRequestType, string> = {
  prescription: 'predpis liekov',
  follow_up: 'objednanie na kontrolu',
  results: 'výsledky vyšetrení',
};

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function simpleEnd(reply: FastifyReply, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function confirmationPrompt(session: NeurocentrumSession): string {
  const type = requestTypeLabels[session.requestType!];
  return `Zhrniem vašu požiadavku. Pacient ${session.patientName}, dátum narodenia ${session.dateOfBirth}, požiadavka ${type}: ${session.detail}. Sú tieto údaje správne? Odpovedzte áno alebo nie.`;
}

function promptFor(session: NeurocentrumSession): string {
  switch (session.step) {
    case 'existing_patient': return session.config.messages.existingPatientQuestion;
    case 'name': return 'Povedzte, prosím, meno a priezvisko pacienta.';
    case 'date_of_birth': return 'Povedzte, prosím, celý dátum narodenia pacienta, napríklad pätnásteho marca 1980.';
    case 'request_type': return 'Čo potrebujete vybaviť? Pre predpis liekov povedzte recept alebo stlačte jednotku. Pre objednanie na kontrolu povedzte kontrola alebo stlačte dvojku. Pre výsledky vyšetrení povedzte výsledky alebo stlačte trojku.';
    case 'detail':
      if (session.requestType === 'prescription') return 'Povedzte, prosím, názvy liekov a dávkovanie, ktoré potrebujete predpísať.';
      if (session.requestType === 'follow_up') return 'Stručne povedzte, o akú kontrolu ide, prípadne aké obdobie vám vyhovuje.';
      return 'Povedzte, prosím, o výsledok akého vyšetrenia ide, napríklad MRI, CT, EMG alebo EEG.';
    case 'confirmation': return confirmationPrompt(session);
  }
}

function renderPrompt(reply: FastifyReply, session: NeurocentrumSession, prefix = ''): FastifyReply {
  neurocentrumSessionService.save(session);
  const twiml = new VoiceResponse();
  const yesNo = session.step === 'existing_patient' || session.step === 'confirmation';
  const requestType = session.step === 'request_type';
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/neurocentrum/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    ...(yesNo || requestType ? { numDigits: 1 } : {}),
    hints: yesNo ? 'áno, nie' : requestType ? 'recept, kontrola, výsledky' : '',
  } as any);
  gather.say(sayOptions, `${prefix}${promptFor(session)}`.trim());
  twiml.redirect('/voice/neurocentrum/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function patientNames(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

function birthDateForEds(value: string, timezone: string): string {
  const parsed = DateTime.fromFormat(value, 'dd.MM.yyyy', { zone: timezone });
  return parsed.isValid ? parsed.toFormat('yyyy-MM-dd') : value;
}

function buildPatientRequestEvent(session: NeurocentrumSession): NeurocentrumPatientRequestEvent {
  const names = patientNames(session.patientName || '');
  const durationSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1_000));
  return {
    event: 'patient_request.created',
    version: 1,
    clinicId: session.config.clinicId,
    callSid: session.callSid,
    occurredAt: new Date().toISOString(),
    call: {
      phone: session.phone,
      durationSeconds,
    },
    patient: {
      existingPatient: true,
      firstName: names.firstName,
      lastName: names.lastName,
      birthDate: birthDateForEds(session.dateOfBirth || '', session.config.timezone),
    },
    request: {
      type: session.requestType!,
      detail: session.detail || '',
    },
  };
}

async function completeCall(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: NeurocentrumSession
): Promise<FastifyReply> {
  try {
    const result = await neurocentrumEdsService.sendPatientRequest(buildPatientRequestEvent(session));
    fastify.log.info({ callSid: session.callSid, clinicId: session.config.clinicId, requestType: session.requestType, result }, 'Neurocentrum request stored in EDS');
    return simpleEnd(reply, session.config.messages.completion);
  } catch (error) {
    fastify.log.error({ err: error, callSid: session.callSid, clinicId: session.config.clinicId }, 'Failed to store Neurocentrum request in EDS');
    return simpleEnd(reply, session.config.messages.technical);
  } finally {
    neurocentrumSessionService.delete(session.callSid);
  }
}

export async function startNeurocentrumVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>,
  configPhoneNumber: string
): Promise<FastifyReply> {
  let config;
  try {
    config = await neurocentrumEdsService.getConfig(configPhoneNumber);
  } catch (error) {
    fastify.log.error({ err: error, callSid: body.CallSid, configPhoneNumber }, 'Failed to start Neurocentrum call without EDS configuration');
    return simpleEnd(reply, NO_CONFIG_MESSAGE);
  }

  if (!config.enabled || config.availability.status === 'disabled') {
    return simpleEnd(reply, config.availability.message || config.messages.technical);
  }
  if (config.availability.status === 'vacation') {
    return simpleEnd(reply, config.availability.message || config.messages.vacation);
  }
  if (config.availability.status === 'outside_hours') {
    return simpleEnd(reply, config.availability.message || config.messages.afterHours);
  }

  const session = neurocentrumSessionService.create(body.CallSid, body.From || '', config);
  if (!session) return simpleEnd(reply, config.messages.busy);

  neurocentrumSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/neurocentrum/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    numDigits: 1,
    hints: 'áno, nie',
  } as any);
  gather.say(sayOptions, `${config.messages.greeting} ${config.messages.existingPatientQuestion}`);
  twiml.redirect('/voice/neurocentrum/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

export function finalizeAbandonedNeurocentrumCall(callSid: string): boolean {
  return neurocentrumSessionService.delete(callSid);
}

export async function neurocentrumVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/neurocentrum/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = neurocentrumSessionService.get(body.CallSid);
    if (!session) return simpleEnd(reply, 'Platnosť hovoru vypršala. Zavolajte, prosím, znova.');
    session.attempts += 1;
    if (session.attempts >= 3) {
      neurocentrumSessionService.delete(session.callSid);
      return simpleEnd(reply, session.config.messages.technical);
    }
    return renderPrompt(reply, session, 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz. ');
  });

  fastify.post('/neurocentrum/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = neurocentrumSessionService.get(body.CallSid);
    if (!session) return simpleEnd(reply, 'Platnosť hovoru vypršala. Zavolajte, prosím, znova.');
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, 'Prepáčte, odpoveď som nezachytila. ');

    if (isNeurocentrumUrgent(answer)) {
      neurocentrumSessionService.delete(session.callSid);
      return simpleEnd(reply, session.config.messages.urgent);
    }

    if (session.step === 'existing_patient') {
      const existing = parseNeurocentrumYesNo(answer);
      if (existing === undefined) return renderPrompt(reply, session, 'Odpovedzte, prosím, áno alebo nie. ');
      session.attempts = 0;
      if (!existing) {
        neurocentrumSessionService.delete(session.callSid);
        return simpleEnd(reply, session.config.messages.newPatient);
      }
      session.step = 'name';
      return renderPrompt(reply, session, 'Ďakujem. ');
    }

    if (session.step === 'name') {
      if (answer.trim().split(/\s+/).length < 2) {
        return renderPrompt(reply, session, 'Potrebujeme meno aj priezvisko pacienta. ');
      }
      session.patientName = answer;
      session.attempts = 0;
      session.step = 'date_of_birth';
      return renderPrompt(reply, session, 'Ďakujem. ');
    }

    if (session.step === 'date_of_birth') {
      const normalized = normalizeNeurocentrumDateOfBirth(answer);
      if (!normalized) {
        session.attempts += 1;
        return renderPrompt(reply, session, 'Dátum sa mi nepodarilo rozpoznať. Povedzte, prosím, celý dátum narodenia. ');
      }
      session.dateOfBirth = normalized;
      session.attempts = 0;
      session.step = 'request_type';
      return renderPrompt(reply, session, 'Rozumiem. ');
    }

    if (session.step === 'request_type') {
      const requestType = parseNeurocentrumRequestType(answer);
      if (!requestType) return renderPrompt(reply, session, 'Vyberte, prosím, recept, kontrolu alebo výsledky. ');
      session.requestType = requestType;
      session.attempts = 0;
      session.step = 'detail';
      return renderPrompt(reply, session, `Rozumiem, ide o ${requestTypeLabels[requestType]}. `);
    }

    if (session.step === 'detail') {
      session.detail = answer;
      session.attempts = 0;
      session.step = 'confirmation';
      return renderPrompt(reply, session, 'Ďakujem. Teraz vašu požiadavku zhrniem. ');
    }

    const confirmed = parseNeurocentrumYesNo(answer);
    if (confirmed === undefined) return renderPrompt(reply, session, 'Odpovedzte, prosím, áno alebo nie. ');
    if (!confirmed) {
      session.patientName = undefined;
      session.dateOfBirth = undefined;
      session.requestType = undefined;
      session.detail = undefined;
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session, 'Dobre, zadajme údaje ešte raz. ');
    }
    return completeCall(fastify, reply, session);
  });
}
