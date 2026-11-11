import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dentbodyBotConfig } from '../config/dentbody.config';
import {
  DentbodyAudioKey,
  dentbodyAudioFiles,
  dentbodyAudioMediaPath,
} from '../config/dentbody-audio.config';
import {
  buildDentbodyResponse,
  DentbodySpokenResponse,
  isDentbodyContinue,
  parseDentbodyIntents,
  shouldEndDentbodyConversation,
} from '../services/dentbody-nlu.service';
import { DentbodySession, dentbodySessionService } from '../services/dentbody-session.service';
import { prixiService } from '../services/prixi.service';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };
const MAX_ANSWERED_QUESTIONS = 10;

const copy = {
  greeting: spoken('Dobrý deň, tu je röntgenové pracovisko na Fedinovej. Ako pomôžem?', 'greeting'),
  followUp: spoken('Môžem vám pomôcť ešte s niečím?', 'followUp'),
  continue: spoken('Nech sa páči, povedzte mi vašu otázku.', 'continue'),
  retry: spoken('Prepáčte, otázke som nerozumela. Skúste ju prosím povedať ešte raz. Pre ordinačné hodiny stlačte jednotku. Pre objednanie a žiadanku dvojku. Pre snímky a výsledky trojku. Pre adresu a kontakt štvorku.', 'retry'),
  fallback: spoken('Túto informáciu nemám spoľahlivo potvrdenú. Napíšte prosím na ambulancia bodka er té gé zavináč dentbodyxray bodka es ká. Ďakujem a dovidenia.', 'fallback'),
  closing: spoken('Ďakujem za zavolanie. Prajem vám príjemný zvyšok dňa. Dovidenia.', 'closing'),
  expired: spoken('Hovor sa nepodarilo dokončiť. Zavolajte prosím znova. Dovidenia.', 'expired'),
  technical: spoken('Momentálne máme technické problémy. Skúste prosím zavolať neskôr. Dovidenia.', 'technical'),
};

function spoken(text: string, ...audioKeys: DentbodyAudioKey[]): DentbodySpokenResponse {
  return { text, audioKeys };
}

function combineSpoken(...parts: DentbodySpokenResponse[]): DentbodySpokenResponse {
  return {
    text: parts.map(part => part.text).join(' '),
    audioKeys: parts.flatMap(part => part.audioKeys),
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

function publicBaseUrl(request: FastifyRequest): string {
  const protocol = firstHeader(request.headers['x-forwarded-proto']) || 'https';
  const host = firstHeader(request.headers['x-forwarded-host']) || firstHeader(request.headers.host) || 'localhost';
  return (process.env.PUBLIC_BASE_URL || `${protocol}://${host}`).replace(/\/$/, '');
}

function hasAudioFiles(audioKeys: DentbodyAudioKey[]): boolean {
  return audioKeys.every(key => existsSync(resolve(__dirname, '../assets/audio', dentbodyAudioFiles[key])));
}

function appendSpoken(
  twiml: InstanceType<typeof VoiceResponse>,
  request: FastifyRequest,
  content: DentbodySpokenResponse
): void {
  if (!hasAudioFiles(content.audioKeys)) {
    twiml.say(sayOptions, content.text);
    return;
  }

  const baseUrl = publicBaseUrl(request);
  for (const audioKey of content.audioKeys) {
    twiml.play(`${baseUrl}${dentbodyAudioMediaPath(audioKey)}`);
  }
}

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function renderEnd(reply: FastifyReply, content: DentbodySpokenResponse): FastifyReply {
  const twiml = new VoiceResponse();
  appendSpoken(twiml, reply.request, content);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function renderPrompt(
  reply: FastifyReply,
  session: DentbodySession,
  content: DentbodySpokenResponse
): FastifyReply {
  dentbodySessionService.save(session);
  const twiml = new VoiceResponse();
  // Finish the prompt before listening. This prevents ambient speech or radio
  // from interrupting the bot and being mistaken for the caller's answer.
  appendSpoken(twiml, reply.request, content);
  twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/dentbody/answer',
    method: 'POST',
    timeout: 4,
    // One second still permits a natural short pause between two clauses while
    // halving the former post-speech delay.
    speechTimeout: 1,
    language: 'sk-SK',
    numDigits: 1,
    hints: 'ordinačné hodiny, otvorené, objednať sa, žiadanka, výmenný lístok, platba kartou, adresa, kde sa nachádza ambulancia, kde vás nájdem, na ktorom poschodí, kam mám ísť, Fedinova, Petržalka, snímka, výsledok, popis, cenník, deti, imobilný pacient',
  } as any);
  twiml.redirect('/voice/dentbody/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

async function resolveClinicId(): Promise<string> {
  const config = await prixiService.getConfig(dentbodyBotConfig.clinic.inboundTwilioNumber);
  const clinicId = String(config.clinicId ?? '').trim();
  if (config.voiceBotEnabled !== true || clinicId !== dentbodyBotConfig.clinic.clinicId) {
    throw new Error(`Blocked Dentbody route: expected clinic 163, received ${clinicId || '<missing>'}`);
  }
  return clinicId;
}

export async function startDentbodyVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const clinicId = await resolveClinicId();
    const session = dentbodySessionService.create(body.CallSid, body.From || '', clinicId);
    return renderPrompt(reply, session, copy.greeting);
  } catch (error) {
    fastify.log.error(error, 'Dentbody clinic routing validation failed');
    return renderEnd(reply, copy.technical);
  }
}

export function finalizeDentbodyCall(callSid: string): boolean {
  const session = dentbodySessionService.get(callSid);
  if (!session) return false;
  dentbodySessionService.delete(callSid);
  return true;
}

export async function dentbodyVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/dentbody/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = dentbodySessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);

    session.failedAttempts += 1;
    if (session.failedAttempts >= 2) {
      dentbodySessionService.delete(session.callSid);
      return renderEnd(reply, copy.fallback);
    }
    return renderPrompt(reply, session, copy.retry);
  });

  fastify.post('/dentbody/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = dentbodySessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);

    if (!answer) {
      session.failedAttempts += 1;
      if (session.failedAttempts >= 2) {
        dentbodySessionService.delete(session.callSid);
        return renderEnd(reply, copy.fallback);
      }
      return renderPrompt(reply, session, copy.retry);
    }

    const intents = parseDentbodyIntents(answer);
    if (shouldEndDentbodyConversation(answer, session.awaitingFollowUp, intents.length > 0)) {
      dentbodySessionService.delete(session.callSid);
      return renderEnd(reply, copy.closing);
    }

    if (session.awaitingFollowUp && isDentbodyContinue(answer)) {
      session.failedAttempts = 0;
      session.awaitingFollowUp = false;
      return renderPrompt(reply, session, copy.continue);
    }

    if (intents.length === 0) {
      session.failedAttempts += 1;
      if (session.failedAttempts >= 2) {
        dentbodySessionService.delete(session.callSid);
        return renderEnd(reply, copy.fallback);
      }
      return renderPrompt(reply, session, copy.retry);
    }

    session.failedAttempts = 0;
    session.answeredQuestions += 1;
    const response = buildDentbodyResponse(intents, answer);
    if (session.answeredQuestions >= MAX_ANSWERED_QUESTIONS) {
      dentbodySessionService.delete(session.callSid);
      return renderEnd(reply, combineSpoken(response, copy.closing));
    }
    session.awaitingFollowUp = true;
    return renderPrompt(reply, session, combineSpoken(response, copy.followUp));
  });
}
