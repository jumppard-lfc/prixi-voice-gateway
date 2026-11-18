import { DateTime } from 'luxon';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import { stefancikBotConfig, stefancikRequestLabels, StefancikRequestType } from '../config/stefancik.config';
import { prixiService } from '../services/prixi.service';
import { prixiVoiceSmsService } from '../services/prixi-voice-sms.service';
import {
  buildStefancikOfficeHoursMessage,
  isStefancikOfficeOpen,
  isStefancikRequestWindowOpen,
} from '../services/stefancik-call-context.service';
import { parseStefancikRequestType } from '../services/stefancik-nlu.service';
import { StefancikSession, stefancikSessionService } from '../services/stefancik-session.service';
import { ClinicConfig, VoicemailRecordedEvent } from '../types';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: Record<string, any> = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

const copy = {
  greeting: 'Dobrý deň, tu je virtuálna sestra PriXi z urologicko-andrologickej ambulancie pána doktora Jána Štefančíka. Ako vám môžem pomôcť? Môžete povedať objednanie, výsledky, recept alebo ordinačné hodiny.',
  menuRetry: 'Prepáčte, nerozumela som. Pre objednanie stlačte jednotku. Pre výsledky dvojku. Pre lieky alebo recept trojku. Pre ordinačné hodiny štvorku.',
  prescriptionPrompt: 'Povedzte, prosím, meno a priezvisko pacienta, názov lieku, jeho silu a počet balení.',
  prescriptionSaved: 'Ďakujem. Vašu požiadavku na lieky som zaznamenala a ambulancia ju dostane v dnešnom súhrne. Dovidenia.',
  prescriptionClosed: 'Dovolali ste sa mimo času na prijímanie požiadaviek. Ohľadom liekov, prosím, zavolajte v pracovný deň doobeda medzi siedmou tridsať a desiatou tridsať. Ďakujem a dovidenia.',
  results: 'Ohľadom výsledkov, prosím, zavolajte v pracovný deň medzi desiatou tridsať a dvanástou. Ďakujem a dovidenia.',
  resultsClosed: 'Ambulancia už teraz neordinuje. Ohľadom výsledkov, prosím, zavolajte v pracovný deň medzi desiatou tridsať a dvanástou. Ďakujem a dovidenia.',
  appointmentWithSms: 'Na vyšetrenie sa objednajte online cez eČakáreň. Odkaz vám pošlem v SMS správe. Ak by správa neprišla, adresa je e čakáreň bodka sk, lomka lekári, lomka Ján Štefančík. Ďakujem a dovidenia.',
  appointmentWithoutSms: 'Na vyšetrenie sa objednajte online cez eČakáreň. Adresa je e čakáreň bodka sk, lomka lekári, lomka Ján Štefančík. Ďakujem a dovidenia.',
  expired: 'Hovor sa nepodarilo dokončiť. Zavolajte, prosím, znova. Dovidenia.',
  technical: 'Momentálne máme technický problém a vašu požiadavku nevieme bezpečne zaznamenať. Skúste, prosím, zavolať neskôr. Dovidenia.',
};

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function renderEnd(reply: FastifyReply, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function renderMenu(reply: FastifyReply, session: StefancikSession, retry = false): FastifyReply {
  session.step = 'menu';
  stefancikSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/stefancik/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    numDigits: 1,
    hints: 'objednanie, termín, výsledky, recept, lieky, ordinačné hodiny',
  } as any);
  gather.say(sayOptions, retry ? copy.menuRetry : copy.greeting);
  twiml.redirect('/voice/stefancik/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderPrescriptionPrompt(reply: FastifyReply, session: StefancikSession, retry = false): FastifyReply {
  session.step = 'prescription_detail';
  stefancikSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech'],
    action: '/voice/stefancik/answer',
    method: 'POST',
    timeout: 7,
    speechTimeout: 'auto',
    language: 'sk-SK',
    hints: 'meno a priezvisko, názov lieku, miligramov, balenie, balenia',
  } as any);
  gather.say(sayOptions, `${retry ? 'Prepáčte, odkaz som nezachytila. ' : ''}${copy.prescriptionPrompt}`);
  twiml.redirect('/voice/stefancik/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function requestDetail(session: StefancikSession): string {
  switch (session.requestType) {
    case 'appointment':
      return session.config.healthcareProviderId
        ? 'Pacient bol nasmerovaný do eČakárne; SMS s odkazom bola vyžiadaná.'
        : 'Pacient bol nasmerovaný do eČakárne; odkaz bol nadiktovaný.';
    case 'results':
      return isStefancikOfficeOpen(session.config)
        ? 'Pacient bol požiadaný, aby zavolal v pracovný deň medzi 10:30 a 12:00.'
        : 'Volanie mimo ordinačných hodín; pacient bol požiadaný, aby zavolal v pracovný deň medzi 10:30 a 12:00.';
    case 'prescription':
      return session.detail || 'Volanie mimo ranného okna; odkaz o liekoch nebol prijatý.';
    case 'office_hours':
      return 'Pacientovi boli prečítané aktuálne ordinačné hodiny.';
    default:
      return 'Požiadavka nebola bližšie určená.';
  }
}

function buildEvent(session: StefancikSession, detail: string): VoicemailRecordedEvent {
  const endedAt = new Date().toISOString();
  return {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: session.routingPhoneNumber,
    durationSeconds: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1_000)),
    callStartedAt: session.startedAt,
    callEndedAt: endedAt,
    providerCallId: session.callSid,
    nameUrl: '',
    birthYearUrl: '',
    problemUrl: '',
    nameTranscript: '',
    birthYearTranscript: '',
    problemTranscript: [
      '[Voice-bot urologicko-andrologická ambulancia MUDr. Jána Štefančíka]',
      `Kategória: ${stefancikRequestLabels[session.requestType!]}`,
      `Požiadavka: ${detail}`,
    ].join('\n'),
  };
}

async function persistRequest(fastify: FastifyInstance, session: StefancikSession): Promise<void> {
  if (!session.requestType) return;
  const detail = requestDetail(session);
  try {
    await prixiService.sendEvent(buildEvent(session, detail), 3, `voicemail_recorded:${session.callSid}`);
  } catch (error) {
    fastify.log.error(
      { err: error, callSid: session.callSid, clinicId: session.clinicId },
      'Failed to store MUDr. Stefancik request in PriXi'
    );
    throw error;
  }
}

async function completeRequest(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: StefancikSession,
  message: string
): Promise<FastifyReply> {
  if (!isStefancikRequestWindowOpen(session.config, DateTime.now())) {
    stefancikSessionService.delete(session.callSid);
    return renderEnd(reply, message);
  }
  try {
    await persistRequest(fastify, session);
    return renderEnd(reply, message);
  } catch (error) {
    fastify.log.error({ err: error, callSid: session.callSid }, 'Failed to persist MUDr. Stefancik request for the daily digest');
    return renderEnd(reply, copy.technical);
  } finally {
    stefancikSessionService.delete(session.callSid);
  }
}

function sendBookingSms(fastify: FastifyInstance, session: StefancikSession): void {
  const healthcareProviderId = session.config.healthcareProviderId;
  if (!healthcareProviderId) return;
  prixiVoiceSmsService.send({
    healthcareProviderId,
    phoneNumber: session.phone,
    message: stefancikBotConfig.booking.sms,
    idempotencyKey: `call-${session.callSid}-sms-stefancik-booking-link`,
  }).then(result => {
    fastify.log.info({ callSid: session.callSid, ...result }, 'MUDr. Stefancik eCakaren SMS accepted by PriXi');
  }).catch(error => {
    fastify.log.error({ err: error, callSid: session.callSid }, 'Failed to send MUDr. Stefancik eCakaren SMS');
  });
}

async function loadConfig(body: Record<string, string>): Promise<ClinicConfig> {
  const routingPhoneNumber = body.To?.trim();
  if (!routingPhoneNumber) throw new Error('Twilio destination number is missing');
  const config = await prixiService.getVoiceAssistantConfig(routingPhoneNumber);
  const clinicId = String(config.clinicId ?? '').trim();
  if (clinicId !== stefancikBotConfig.clinic.clinicId || config.assistantType !== 'stefancik') {
    throw new Error(`Blocked Stefancik route: expected clinic ${stefancikBotConfig.clinic.clinicId}, received ${clinicId || '<missing>'} and assistant ${config.assistantType || '<missing>'}`);
  }
  return config;
}

export async function startStefancikVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const config = await loadConfig(body);
    if (config.enabled === false || config.voiceBotEnabled === false || config.availability?.status === 'disabled') {
      return renderEnd(reply, config.availability?.message?.trim() || copy.technical);
    }
    if (config.availability?.status === 'vacation') {
      return renderEnd(
        reply,
        config.availability.message?.trim() || config.messages?.vacation?.trim() || 'Ambulancia má momentálne dovolenku. Ďakujeme za pochopenie a dovidenia.'
      );
    }
    const session = stefancikSessionService.create(
      body.CallSid,
      body.From || '',
      body.To,
      config
    );
    return renderMenu(reply, session);
  } catch (error) {
    fastify.log.error({ err: error, callSid: body.CallSid, to: body.To }, 'MUDr. Stefancik routing validation failed');
    return renderEnd(reply, copy.technical);
  }
}

export async function finalizeAbandonedStefancikCall(
  fastify: FastifyInstance,
  callSid: string
): Promise<boolean> {
  const session = stefancikSessionService.get(callSid);
  if (!session) return false;
  stefancikSessionService.delete(callSid);
  if (!session.requestType) return false;
  if (!isStefancikRequestWindowOpen(session.config, DateTime.now())) return false;
  if (session.requestType === 'prescription' && !session.detail) {
    session.detail = 'Hovor bol prerušený pred zanechaním detailu o liekoch.';
  }
  try {
    await persistRequest(fastify, session);
    return true;
  } catch (error) {
    fastify.log.error({ err: error, callSid }, 'Failed to preserve abandoned MUDr. Stefancik request');
    return false;
  }
}

export async function stefancikVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/stefancik/incoming', async (request, reply) => {
    return startStefancikVoiceBot(fastify, reply, request.body as Record<string, string>);
  });

  fastify.post('/stefancik/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = stefancikSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    session.attempts += 1;
    if (session.attempts >= 3) {
      await finalizeAbandonedStefancikCall(fastify, session.callSid);
      return renderEnd(reply, copy.expired);
    }
    return session.step === 'prescription_detail'
      ? renderPrescriptionPrompt(reply, session, true)
      : renderMenu(reply, session, true);
  });

  fastify.post('/stefancik/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = stefancikSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) {
      return session.step === 'prescription_detail'
        ? renderPrescriptionPrompt(reply, session, true)
        : renderMenu(reply, session, true);
    }

    if (session.step === 'prescription_detail') {
      session.detail = answer;
      return completeRequest(fastify, reply, session, copy.prescriptionSaved);
    }

    const requestType = parseStefancikRequestType(answer);
    if (!requestType) return renderMenu(reply, session, true);
    session.requestType = requestType;
    session.attempts = 0;
    stefancikSessionService.save(session);

    if (requestType === 'appointment') {
      sendBookingSms(fastify, session);
      const message = session.config.healthcareProviderId ? copy.appointmentWithSms : copy.appointmentWithoutSms;
      return completeRequest(fastify, reply, session, message);
    }
    if (requestType === 'results') {
      return completeRequest(
        fastify,
        reply,
        session,
        isStefancikOfficeOpen(session.config, DateTime.now()) ? copy.results : copy.resultsClosed
      );
    }
    if (requestType === 'office_hours') {
      return completeRequest(
        fastify,
        reply,
        session,
        `${buildStefancikOfficeHoursMessage(session.config)} Ďakujem a dovidenia.`
      );
    }
    if (!isStefancikRequestWindowOpen(session.config, DateTime.now())) {
      return completeRequest(fastify, reply, session, copy.prescriptionClosed);
    }
    return renderPrescriptionPrompt(reply, session);
  });

  fastify.post('/stefancik/call-status', async (request, reply) => {
    const body = request.body as Record<string, string>;
    reply.code(204).send();
    if (body.CallSid && new Set(['completed', 'canceled', 'failed', 'busy', 'no-answer']).has(body.CallStatus)) {
      await finalizeAbandonedStefancikCall(fastify, body.CallSid);
    }
  });
}
