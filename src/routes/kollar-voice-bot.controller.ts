import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import { kollarBotConfig, KollarRequestType } from '../config/kollar.config';
import { parseKollarIdentity, parseKollarRequestType } from '../services/kollar-nlu.service';
import { KollarSession, kollarSessionService } from '../services/kollar-session.service';
import { prixiService } from '../services/prixi.service';
import { sttService } from '../services/stt.service';
import { VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, createVoiceEventKey, failVoiceEvent } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

const copy = {
  greeting: 'Prepáčte za zdržanie, tu virtuálna sestra PriXi od pána doktora Kollára. Ako vám pomôžem?',
  menuRetry: 'Prepáčte, nerozumela som. Pre akútny problém stlačte jednotku. Pre recept dvojku. Pre výsledok vyšetrenia trojku. Pre objednanie štvorku. Ak chcete byť nová pacientka, stlačte päťku. Pre ordinačné hodiny šestku. Ak sa chcete rozprávať s človekom, stlačte sedmičku.',
  acuteProblem: 'Povedzte prosím v jednej vete váš akútny problém.',
  prescription: 'Aké lieky si prajete predpísať? Uveďte prosím názov lieku a počet balení.',
  identity: 'Rozumiem. Povedzte prosím ešte vaše celé meno a rok narodenia.',
  results: 'Rozumiem. Požiadavku pretlmočím ambulancii a ozveme sa vám čo najskôr. Prajem ešte pekný zvyšok dňa. Dovidenia.',
  appointment: 'Rozumiem. Požiadavku na objednanie pretlmočím ambulancii. Ambulancia sa vám ozve čo najskôr pre dohodnutie termínu. Prosím pripravte si dátum poslednej menštruácie. Prajem ešte pekný zvyšok dňa. Dovidenia.',
  newPatient: 'Sme radi že chcete byť našou pacientkou. Pre registráciu prosím vyplňte formulár na www.prváženská.sk a kliknite na tlačidlo Preniesť kartu a následne postupujte podľa pokynov. Prajem ešte pekný zvyšok dňa. Dovidenia.',
  officeHours: 'Ordinačné hodiny sú: v pondelok od deviatej do sedemnástej hodiny, na objednávku aj medzi sedemnástou a osemnástou hodinou. V utorok od siedmej do šestnástej hodiny. Utorok je prednostne tehotenská poradňa. V stredu od siedmej do trinástej hodiny. Vo štvrtok od desiatej do sedemnástej hodiny, na objednávku aj medzi sedemnástou a osemnástou hodinou. V piatok neordinujeme. Verím že som vám pomohla a prajem ešte pekný zvyšok dňa. Dovidenia.',
  humanMessage: 'Samozrejme rozumiem. Po zaznení tónu zanechajte prosím krátky odkaz a my sa vám ozveme čo najskôr.',
  acuteProblemSaved: 'Rozumiem. Váš akútny problém pretlmočím ambulancii a ozveme sa vám čo najskôr. Prajem ešte pekný zvyšok dňa. Dovidenia.',
  prescriptionSaved: 'Rozumiem. Vašu požiadavku na recept pretlmočím ambulancii a ozveme sa vám čo najskôr. Prajem ešte pekný zvyšok dňa. Dovidenia.',
  messageSaved: 'Ďakujem. Váš odkaz pretlmočím ambulancii a ozveme sa vám čo najskôr. Prajem ešte pekný zvyšok dňa. Dovidenia.',
  expired: 'Hovor sa nepodarilo dokončiť. Zavolajte prosím znova. Dovidenia.',
  technical: 'Momentálne máme technické problémy. Skúste prosím zavolať neskôr. Dovidenia.',
};

const requestLabels: Record<KollarRequestType, string> = {
  acute_problem: 'akútny problém',
  prescription: 'žiadosť o recept',
  results: 'výsledok vyšetrenia',
  appointment: 'žiadosť o objednanie',
  new_patient: 'nová pacientka',
  office_hours: 'ordinačné hodiny',
  human_message: 'odkaz pre ambulanciu',
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

function renderMenu(reply: FastifyReply, session: KollarSession, retry = false): FastifyReply {
  kollarSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/kollar/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    numDigits: 1,
    hints: 'akútny problém, recept, výsledok vyšetrenia, objednať sa, nová pacientka, ordinačné hodiny, človek, sestra',
  } as any);
  gather.say(sayOptions, retry ? copy.menuRetry : copy.greeting);
  twiml.redirect('/voice/kollar/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderDetailPrompt(reply: FastifyReply, session: KollarSession, retry = false): FastifyReply {
  kollarSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech'],
    action: '/voice/kollar/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
  } as any);
  const prompt = session.requestType === 'prescription' ? copy.prescription : copy.acuteProblem;
  gather.say(sayOptions, `${retry ? 'Prepáčte, odpoveď som nezachytila. ' : ''}${prompt}`);
  twiml.redirect('/voice/kollar/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderIdentityPrompt(
  reply: FastifyReply,
  session: KollarSession,
  retry = false
): FastifyReply {
  session.step = 'identity';
  kollarSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech'],
    action: '/voice/kollar/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    hints: 'meno a priezvisko, 1950, 1960, 1970, 1980, 1990, 2000',
  } as any);
  gather.say(
    sayOptions,
    retry
      ? 'Prepáčte, celé meno alebo rok narodenia som nezachytila. Povedzte prosím vaše celé meno a rok narodenia ešte raz.'
      : copy.identity
  );
  twiml.redirect('/voice/kollar/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderCurrentPrompt(reply: FastifyReply, session: KollarSession, retry = false): FastifyReply {
  if (session.step === 'main_menu') return renderMenu(reply, session, retry);
  if (session.step === 'detail') return renderDetailPrompt(reply, session, retry);
  if (session.step === 'identity') return renderIdentityPrompt(reply, session, retry);
  return renderEnd(reply, copy.expired);
}

function renderHumanRecording(reply: FastifyReply, session: KollarSession): FastifyReply {
  session.step = 'recording';
  kollarSessionService.save(session);
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, copy.humanMessage);
  twiml.record({
    action: '/voice/kollar/message',
    method: 'POST',
    playBeep: true,
    maxLength: 120,
    timeout: 5,
    finishOnKey: '#',
  });
  return reply.type('text/xml').send(twiml.toString());
}

async function resolveClinicId(): Promise<string> {
  const config = await prixiService.getConfig(kollarBotConfig.clinic.inboundTwilioNumber);
  const clinicId = String(config.clinicId ?? '').trim();
  if (config.voiceBotEnabled !== true || clinicId !== kollarBotConfig.clinic.clinicId) {
    throw new Error(`Blocked Kollar route: expected clinic 155, received ${clinicId || '<missing>'}`);
  }
  return clinicId;
}

function hasMeaningfulRequest(session: KollarSession): boolean {
  if (session.requestType === 'results' || session.requestType === 'appointment') return true;
  return Boolean(session.detail || session.recordingUrl);
}

function buildProblemTranscript(session: KollarSession): string {
  return [
    '[Voice-bot gynekologická ambulancia MUDr. Kollára]',
    `Stav hovoru: ${session.outcome === 'abandoned' ? 'NEDOKONČENÝ – volajúca zložila pred ukončením flow' : 'dokončený'}`,
    `Kategória: ${session.requestType ? requestLabels[session.requestType] : 'nezistená'}`,
    `Telefón: ${session.phone}`,
    `Meno a priezvisko: ${session.patientName || 'neuvedené'}`,
    `Rok narodenia: ${session.birthYear || 'neuvedený'}`,
    `**Požiadavka:** ${session.detail || requestLabels[session.requestType || 'human_message']}`,
    ...(session.answers.length ? [`Prepis odpovedí: ${session.answers.map(answer => answer.text).join(' | ')}`] : []),
  ].join('\n');
}

function buildEvent(session: KollarSession): VoicemailRecordedEvent {
  const endedAt = session.endedAt || new Date().toISOString();
  return {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: kollarBotConfig.clinic.inboundTwilioNumber,
    durationSeconds: session.recordingDurationSeconds
      ?? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000)),
    callStartedAt: session.startedAt,
    callEndedAt: endedAt,
    providerCallId: session.callSid,
    nameUrl: '',
    birthYearUrl: '',
    problemUrl: session.recordingUrl || '',
    nameTranscript: session.patientName || '',
    birthYearTranscript: session.birthYear || '',
    problemTranscript: buildProblemTranscript(session),
  };
}

function dispatchRequest(fastify: FastifyInstance, session: KollarSession, onSuccess?: () => void): boolean {
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
      fastify.log.error(error, 'Failed to create MUDr. Kollar PriXi request');
    });
  return true;
}

function dispatchRecordedMessage(fastify: FastifyInstance, session: KollarSession): boolean {
  if (!session.recordingUrl) return false;
  const eventKey = createVoiceEventKey('voicemail_recorded', session.callSid);
  if (!claimVoiceEvent(eventKey)) return false;

  const audioUrl = /\.(mp3|wav)(?:\?|$)/i.test(session.recordingUrl)
    ? session.recordingUrl
    : `${session.recordingUrl}.mp3`;
  sttService.transcribeAudioUrl(
    audioUrl,
    'Krátky telefonický odkaz pacientky pre gynekologickú ambulanciu v slovenčine. Zachovaj všetky medicínske a kontaktné údaje.'
  )
    .catch(error => {
      fastify.log.error(error, 'Failed to transcribe MUDr. Kollar recorded message; preserving the recording');
      return 'Hlasový odkaz je priložený bez prepisu.';
    })
    .then(transcript => {
      session.detail = transcript.trim() || 'Hlasový odkaz je priložený bez prepisu.';
      return prixiService.sendEvent(buildEvent(session), 3, eventKey);
    })
    .then(() => {
      completeVoiceEvent(eventKey);
      kollarSessionService.delete(session.callSid);
    })
    .catch(error => {
      failVoiceEvent(eventKey);
      fastify.log.error(error, 'Failed to transcribe or create MUDr. Kollar recorded message');
    });
  return true;
}

function completeCall(fastify: FastifyInstance, reply: FastifyReply, session: KollarSession, message: string): FastifyReply {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  dispatchRequest(fastify, session);
  kollarSessionService.delete(session.callSid);
  return renderEnd(reply, message);
}

function completeIdentifiedRequest(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: KollarSession
): FastifyReply {
  if (session.requestType === 'human_message') return renderHumanRecording(reply, session);
  if (session.requestType === 'results') return completeCall(fastify, reply, session, copy.results);
  if (session.requestType === 'appointment') return completeCall(fastify, reply, session, copy.appointment);
  if (session.requestType === 'prescription') return completeCall(fastify, reply, session, copy.prescriptionSaved);
  return completeCall(fastify, reply, session, copy.acuteProblemSaved);
}

export async function startKollarVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const clinicId = await resolveClinicId();
    return renderMenu(reply, kollarSessionService.create(body.CallSid, body.From || '', clinicId));
  } catch (error) {
    fastify.log.error(error, 'MUDr. Kollar clinic routing validation failed');
    return renderEnd(reply, copy.technical);
  }
}

export function finalizeAbandonedKollarCall(
  fastify: FastifyInstance,
  callSid: string,
  endedAt: string = new Date().toISOString()
): boolean {
  const session = kollarSessionService.get(callSid);
  if (!session) return false;
  if (!hasMeaningfulRequest(session)) {
    kollarSessionService.delete(callSid);
    return false;
  }
  session.outcome = 'abandoned';
  session.endedAt = endedAt;
  kollarSessionService.save(session);
  return dispatchRequest(fastify, session, () => kollarSessionService.delete(callSid));
}

export async function kollarVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/kollar/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kollarSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    session.attempts += 1;
    if (session.attempts >= 3) {
      finalizeAbandonedKollarCall(fastify, session.callSid);
      return renderEnd(reply, copy.expired);
    }
    return renderCurrentPrompt(reply, session, true);
  });

  fastify.post('/kollar/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kollarSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) {
      session.attempts += 1;
      if (session.attempts >= 3) {
        kollarSessionService.delete(session.callSid);
        return renderEnd(reply, copy.expired);
      }
      return renderCurrentPrompt(reply, session, true);
    }
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'main_menu') {
      const requestType = parseKollarRequestType(answer);
      if (!requestType) {
        session.attempts += 1;
        if (session.attempts >= 3) {
          kollarSessionService.delete(session.callSid);
          return renderEnd(reply, copy.expired);
        }
        return renderMenu(reply, session, true);
      }
      session.requestType = requestType;
      session.attempts = 0;

      if (requestType === 'acute_problem' || requestType === 'prescription') {
        return renderIdentityPrompt(reply, session);
      }
      if (requestType === 'results' || requestType === 'appointment' || requestType === 'human_message') {
        return renderIdentityPrompt(reply, session);
      }

      kollarSessionService.delete(session.callSid);
      return renderEnd(reply, requestType === 'new_patient' ? copy.newPatient : copy.officeHours);
    }

    if (session.step === 'detail') {
      session.detail = answer;
      return completeIdentifiedRequest(fastify, reply, session);
    }

    if (session.step === 'identity') {
      const identity = parseKollarIdentity(answer);
      if (!identity.patientName || !identity.birthYear) {
        session.attempts += 1;
        if (session.attempts >= 3) {
          kollarSessionService.delete(session.callSid);
          return renderEnd(reply, copy.expired);
        }
        return renderIdentityPrompt(reply, session, true);
      }
      session.patientName = identity.patientName;
      session.birthYear = identity.birthYear;
      session.attempts = 0;
      if (session.requestType === 'acute_problem' || session.requestType === 'prescription') {
        session.step = 'detail';
        return renderDetailPrompt(reply, session);
      }
      return completeIdentifiedRequest(fastify, reply, session);
    }

    return renderEnd(reply, copy.expired);
  });

  fastify.post('/kollar/message', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kollarSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    if (!body.RecordingUrl) {
      kollarSessionService.delete(session.callSid);
      return renderEnd(reply, copy.technical);
    }

    session.recordingUrl = body.RecordingUrl;
    session.recordingDurationSeconds = Number.parseInt(body.RecordingDuration || '0', 10) || 0;
    session.outcome = 'completed';
    session.endedAt = new Date().toISOString();
    kollarSessionService.save(session);
    dispatchRecordedMessage(fastify, session);
    return renderEnd(reply, copy.messageSaved);
  });
}
