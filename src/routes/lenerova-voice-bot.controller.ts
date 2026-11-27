import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import {
  lenerovaBotConfig,
  lenerovaRequestLabels,
  LenerovaRequestType,
} from '../config/lenerova.config';
import {
  isLenerovaConversationContinue,
  isLenerovaConversationFinish,
  isLenerovaInformationMenuChoice,
  parseLenerovaRequestType,
} from '../services/lenerova-nlu.service';
import { buildLenerovaInformationAnswer } from '../services/lenerova-information.service';
import {
  LenerovaSession,
  lenerovaSessionService,
} from '../services/lenerova-session.service';
import { prixiService } from '../services/prixi.service';
import { mailerSendService } from '../services/mailersend.service';
import { ClinicConfig, VoicemailRecordedEvent } from '../types';
import {
  claimVoiceEvent,
  completeVoiceEvent,
  createVoiceEventKey,
  failVoiceEvent,
} from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: Record<string, any> = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };
const MAX_ANSWERED_INFORMATION_QUESTIONS = 10;

const copy = {
  greeting: 'Dobrý deň, dovolali ste sa virtuálnej sestričke pani doktorky Lenerovej. Ako pomôžem?',
  menuRetry: 'Prepáčte, nerozumela som. Pre recept stlačte jednotku. Pre požiadavku na termín dvojku. Pre zmenu alebo zrušenie termínu trojku. Pre zhoršenie stavu štvorku. Pre dokumenty a administratívu päťku. Ak ste nový pacient šestku. Pre organizačné informácie sedmičku.',
  name: 'Povedzte, prosím, meno a priezvisko pacienta, ktorého sa požiadavka týka.',
  birthYear: 'Povedzte, prosím, rok narodenia pacienta.',
  retry: 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz. ',
  informationFollowUp: 'Je to všetko, alebo vám môžem pomôcť ešte s niečím?',
  continue: 'Nech sa páči. S čím ďalším vám môžem pomôcť?',
  closing: 'Ďakujem za zavolanie. Prajem príjemný deň. Dovidenia.',
  expired: 'Hovor sa nepodarilo dokončiť. Zavolajte, prosím, znova. Dovidenia.',
  technical: 'Momentálne máme technický problém a vašu požiadavku nevieme bezpečne zaznamenať. Skúste, prosím, zavolať neskôr. Dovidenia.',
};

const detailPrompts: Record<LenerovaRequestType, string> = {
  prescription: 'Uveďte názov pravidelne užívaného lieku, jeho silu, dávkovanie a približne koľko lieku vám zostáva.',
  appointment: 'Povedzte, prosím, či ide o pravidelnú kontrolu alebo inú požiadavku na termín a aké obdobie vám približne vyhovuje.',
  appointment_change: 'Uveďte dátum pôvodného termínu a či ho potrebujete zmeniť alebo zrušiť.',
  worsening: 'Stručne opíšte zhoršenie stavu alebo problém s liekom, ktorý má ambulancia posúdiť.',
  administration: 'Povedzte, prosím, aký dokument, potvrdenie, správu alebo inú administratívnu požiadavku potrebujete.',
  new_patient: 'Stručne povedzte, s akými ťažkosťami sa chcete obrátiť na ambulanciu a či vás odporučil iný lekár.',
  information: 'Povedzte, prosím, akú organizačnú informáciu potrebujete, napríklad ordinačné hodiny, pracovisko, poisťovňu alebo zastupovanie.',
};

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function promptFor(session: LenerovaSession, retry: boolean): string {
  if (session.step === 'main_menu') return retry ? copy.menuRetry : copy.greeting;
  if (session.step === 'information_follow_up') return copy.informationFollowUp;
  if (session.step === 'name') return `${retry ? copy.retry : ''}${copy.name}`;
  if (session.step === 'birth_year') return `${retry ? copy.retry : ''}${copy.birthYear}`;
  const detailPrompt = session.requestType ? detailPrompts[session.requestType] : copy.menuRetry;
  return `${retry ? copy.retry : ''}${detailPrompt}`;
}

function renderPrompt(
  reply: FastifyReply,
  session: LenerovaSession,
  retry = false,
  promptOverride?: string
): FastifyReply {
  lenerovaSessionService.save(session);
  const twiml = new VoiceResponse();
  const isMenu = session.step === 'main_menu' || session.step === 'information_follow_up';
  const gather = twiml.gather({
    input: isMenu ? ['speech', 'dtmf'] : ['speech'],
    action: '/voice/lenerova/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    ...(isMenu ? {
      numDigits: 1,
      hints: 'áno, nie, ďakujem, recept, termín kontroly, zmena termínu, zrušenie termínu, zhoršenie stavu, dokument, nový pacient, ordinačné hodiny',
    } : {}),
  } as any);
  gather.say(sayOptions, promptOverride || promptFor(session, retry));
  twiml.redirect('/voice/lenerova/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderEnd(reply: FastifyReply, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function resetForNextRequest(session: LenerovaSession): void {
  session.step = 'main_menu';
  session.requestType = undefined;
  session.patientName = undefined;
  session.birthYear = undefined;
  session.detail = undefined;
  session.attempts = 0;
}

function renderInformationAnswer(reply: FastifyReply, session: LenerovaSession, question: string): FastifyReply {
  session.step = 'information_follow_up';
  session.requestType = undefined;
  session.patientName = undefined;
  session.birthYear = undefined;
  session.detail = undefined;
  session.attempts = 0;
  const answer = buildLenerovaInformationAnswer(session.config, question);
  session.answeredInformationQuestions += 1;
  if (session.answeredInformationQuestions >= MAX_ANSWERED_INFORMATION_QUESTIONS) {
    lenerovaSessionService.delete(session.callSid);
    return renderEnd(reply, `${answer} ${copy.closing}`);
  }
  return renderPrompt(reply, session, false, `${answer} ${copy.informationFollowUp}`);
}

async function loadConfig(): Promise<ClinicConfig> {
  const config = await prixiService.getVoiceAssistantConfig(lenerovaBotConfig.clinic.inboundTwilioNumber);
  const clinicId = String(config.clinicId ?? '').trim();
  if (
    clinicId !== lenerovaBotConfig.clinic.clinicId
    || config.assistantType !== lenerovaBotConfig.clinic.assistantType
  ) {
    throw new Error(
      `Blocked Lenerova route: expected clinic ${lenerovaBotConfig.clinic.clinicId} and assistant ${lenerovaBotConfig.clinic.assistantType}, received clinic ${clinicId || '<missing>'} and assistant ${config.assistantType || '<missing>'}`
    );
  }
  return config;
}

function hasMeaningfulRequest(session: LenerovaSession): boolean {
  return Boolean(session.requestType && session.requestType !== 'information');
}

function requestSummary(session: LenerovaSession): string {
  if (session.detail) return session.detail;
  if (session.outcome === 'abandoned') {
    return `Hovor bol ukončený pred doplnením celej požiadavky. Posledný krok: ${session.step}.`;
  }
  return 'Detail požiadavky nebol uvedený.';
}

function buildProblemTranscript(session: LenerovaSession): string {
  return [
    '[Voice-bot psychiatrická ambulancia MUDr. Slávky Lenerovej]',
    `Stav hovoru: ${session.outcome === 'abandoned' ? 'NEDOKONČENÝ – volajúci zložil pred ukončením flow' : 'dokončený'}`,
    `Kategória: ${session.requestType ? lenerovaRequestLabels[session.requestType] : 'nezistená'}`,
    `Telefón: ${session.phone}`,
    `Meno a priezvisko: ${session.patientName || 'neuvedené'}`,
    `Rok narodenia: ${session.birthYear || 'neuvedený'}`,
    `Požiadavka: ${requestSummary(session)}`,
    ...(session.requestType === 'appointment'
      ? ['Konkrétny termín nebol rezervovaný; ambulancia má pacienta kontaktovať.']
      : []),
    ...(session.answers.length
      ? [`Prepis odpovedí: ${session.answers.map((answer) => `${answer.step}: ${answer.text}`).join(' | ')}`]
      : []),
  ].join('\n');
}

function buildEvent(session: LenerovaSession): VoicemailRecordedEvent {
  const endedAt = session.endedAt || new Date().toISOString();
  return {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: lenerovaBotConfig.clinic.routingPhoneNumber,
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

async function notifyLenerovaByEmail(
  fastify: FastifyInstance,
  event: VoicemailRecordedEvent
): Promise<void> {
  if (!mailerSendService.isLenerovaConfigured()) {
    fastify.log.warn(
      { providerCallId: event.providerCallId, clinicId: event.clinicId },
      'MailerSend or MUDr. Lenerova recipient is not configured; request was stored in PriXi without email notification'
    );
    return;
  }

  try {
    const messageId = await mailerSendService.sendLenerovaRequest(event);
    fastify.log.info(
      { providerCallId: event.providerCallId, clinicId: event.clinicId, messageId },
      'MUDr. Lenerova request queued in MailerSend'
    );
  } catch (error) {
    fastify.log.error(
      { err: error, providerCallId: event.providerCallId, clinicId: event.clinicId },
      'Failed to queue MUDr. Lenerova email notification; request remains stored in PriXi'
    );
  }
}

async function dispatchRequest(fastify: FastifyInstance, session: LenerovaSession): Promise<boolean> {
  if (!hasMeaningfulRequest(session)) return false;
  const eventKey = createVoiceEventKey('voicemail_recorded', session.callSid);
  if (!claimVoiceEvent(eventKey)) return true;

  try {
    const event = buildEvent(session);
    await prixiService.sendEvent(event, 3, eventKey);
    await notifyLenerovaByEmail(fastify, event);
    completeVoiceEvent(eventKey);
    return true;
  } catch (error) {
    failVoiceEvent(eventKey);
    fastify.log.error(
      { err: error, callSid: session.callSid, clinicId: session.clinicId },
      'Failed to create MUDr. Lenerova PriXi request'
    );
    return false;
  }
}

function closingMessage(session: LenerovaSession): string {
  if (session.requestType === 'prescription') {
    return 'Ďakujem. Vašu žiadosť o recept som odoslala ambulancii. O vystavení receptu rozhodne pani doktorka. Dovidenia.';
  }
  if (session.requestType === 'appointment') {
    return 'Ďakujem. Vašu požiadavku na termín som odoslala ambulancii. Toto nie je potvrdenie rezervácie. Ambulancia vás bude kontaktovať. Dovidenia.';
  }
  if (session.requestType === 'new_patient') {
    return 'Ďakujem. Vašu požiadavku som odoslala ambulancii. Toto nie je potvrdenie prijatia ani termínu. Ambulancia posúdi svoju kapacitu a následne vás bude kontaktovať. Dovidenia.';
  }
  return 'Ďakujem. Vašu požiadavku som odoslala ambulancii spolu s vaším telefónnym číslom. Dovidenia.';
}

async function completeCall(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: LenerovaSession
): Promise<FastifyReply> {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  const sent = await dispatchRequest(fastify, session);
  lenerovaSessionService.delete(session.callSid);
  return renderEnd(reply, sent ? closingMessage(session) : copy.technical);
}

export async function startLenerovaVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const config = await loadConfig();
    if (config.enabled === false || config.voiceBotEnabled === false || config.availability?.status === 'disabled') {
      return renderEnd(reply, config.availability?.message?.trim() || copy.technical);
    }
    return renderPrompt(reply, lenerovaSessionService.create(body.CallSid, body.From || '', config));
  } catch (error) {
    fastify.log.error(
      { err: error, callSid: body.CallSid, to: body.To },
      'MUDr. Lenerova routing validation failed'
    );
    return renderEnd(reply, copy.technical);
  }
}

export async function finalizeAbandonedLenerovaCall(
  fastify: FastifyInstance,
  callSid: string,
  endedAt: string = new Date().toISOString()
): Promise<boolean> {
  const session = lenerovaSessionService.get(callSid);
  if (!session) return false;
  if (!hasMeaningfulRequest(session)) {
    lenerovaSessionService.delete(callSid);
    return false;
  }
  session.outcome = 'abandoned';
  session.endedAt = endedAt;
  lenerovaSessionService.save(session);
  const sent = await dispatchRequest(fastify, session);
  if (sent) lenerovaSessionService.delete(callSid);
  return sent;
}

export async function lenerovaVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/lenerova/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = lenerovaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    session.attempts += 1;
    if (session.attempts >= 3) {
      await finalizeAbandonedLenerovaCall(fastify, session.callSid);
      return renderEnd(reply, copy.expired);
    }
    return renderPrompt(reply, session, true);
  });

  fastify.post('/lenerova/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = lenerovaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, true);
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'information_follow_up') {
      if (isLenerovaConversationFinish(answer)) {
        lenerovaSessionService.delete(session.callSid);
        return renderEnd(reply, copy.closing);
      }
      if (isLenerovaConversationContinue(answer)) {
        resetForNextRequest(session);
        return renderPrompt(reply, session, false, copy.continue);
      }

      const nextRequestType = parseLenerovaRequestType(answer);
      if (!nextRequestType) return renderPrompt(reply, session, true, copy.menuRetry);
      if (nextRequestType === 'information') {
        if (isLenerovaInformationMenuChoice(answer)) {
          session.requestType = 'information';
          session.attempts = 0;
          session.step = 'detail';
          return renderPrompt(reply, session);
        }
        return renderInformationAnswer(reply, session, answer);
      }
      session.requestType = nextRequestType;
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'main_menu') {
      const requestType = parseLenerovaRequestType(answer);
      if (!requestType) return renderPrompt(reply, session, true);
      if (requestType === 'information') {
        if (isLenerovaInformationMenuChoice(answer)) {
          session.requestType = 'information';
          session.attempts = 0;
          session.step = 'detail';
          return renderPrompt(reply, session);
        }
        return renderInformationAnswer(reply, session, answer);
      }
      session.requestType = requestType;
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'name') {
      session.patientName = answer;
      session.attempts = 0;
      session.step = 'birth_year';
      return renderPrompt(reply, session);
    }

    if (session.step === 'birth_year') {
      session.birthYear = answer;
      session.attempts = 0;
      session.step = 'detail';
      return renderPrompt(reply, session);
    }

    if (session.requestType === 'information') {
      return renderInformationAnswer(reply, session, answer);
    }

    session.detail = answer;
    return completeCall(fastify, reply, session);
  });
}
