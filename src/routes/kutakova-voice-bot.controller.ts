import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import twilio from 'twilio';
import { kutakovaBotConfig } from '../config/kutakova.config';
import { parseKutakovaHealthInsurer } from '../services/kutakova-nlu.service';
import { KutakovaSession, kutakovaSessionService } from '../services/kutakova-session.service';
import { NeurocentrumPatientRequestEvent, neurocentrumEdsService } from '../services/neurocentrum-eds.service';
import {
  isNeurocentrumUrgent,
  normalizeNeurocentrumDateOfBirth,
  parseNeurocentrumYesNo,
} from '../services/neurocentrum-nlu.service';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: Record<string, any> = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

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

function promptFor(session: KutakovaSession): string {
  switch (session.step) {
    case 'consent': return kutakovaBotConfig.messages.consent;
    case 'name': return 'Povedzte, prosím, svoje meno a priezvisko.';
    case 'date_of_birth': return 'Povedzte, prosím, svoj celý dátum narodenia, napríklad pätnásteho marca 1980.';
    case 'health_insurer': return 'V ktorej zdravotnej poisťovni ste poistený? Pre Všeobecnú zdravotnú poisťovňu povedzte Všeobecná alebo stlačte jednotku. Pre Dôveru povedzte Dôvera alebo stlačte dvojku. Pre Union povedzte Union alebo stlačte trojku. Ak máte inú poisťovňu alebo si nie ste istý, stlačte štvorku.';
    case 'municipality': return 'Povedzte, prosím, obec alebo mesto svojho bydliska. Úplnú adresu od vás teraz nepotrebujeme.';
    case 'confirmation':
      return `Zhrniem údaje. Meno ${session.patientName}. Dátum narodenia ${session.dateOfBirth}. Poisťovňa ${session.healthInsurer}. Bydlisko ${session.municipality}. Sú údaje správne? Povedzte áno alebo stlačte jednotku. Ak nie sú správne, povedzte nie alebo stlačte dvojku.`;
  }
}

function renderPrompt(reply: FastifyReply, session: KutakovaSession, prefix = ''): FastifyReply {
  kutakovaSessionService.save(session);
  const yesNo = session.step === 'consent' || session.step === 'confirmation';
  const insurer = session.step === 'health_insurer';
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/kutakova/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    ...(yesNo ? { numDigits: 1, hints: 'áno, nie' } : {}),
    ...(insurer ? { numDigits: 1, hints: 'Všeobecná zdravotná poisťovňa, Dôvera, Union' } : {}),
  } as any);
  gather.say(sayOptions, `${prefix}${promptFor(session)}`.trim());
  twiml.redirect('/voice/kutakova/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function patientNames(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

function birthDateForEds(value: string): string {
  const parsed = DateTime.fromFormat(value, 'dd.MM.yyyy', { zone: kutakovaBotConfig.clinic.timezone });
  return parsed.isValid ? parsed.toFormat('yyyy-MM-dd') : value;
}

function buildPreRegistrationEvent(session: KutakovaSession): NeurocentrumPatientRequestEvent {
  const names = patientNames(session.patientName || '');
  const healthInsurer = session.healthInsurer || '';
  const municipality = session.municipality || '';
  const consentRecordedAt = session.consentRecordedAt || '';
  return {
    event: 'patient_request.created',
    version: 1,
    clinicId: kutakovaBotConfig.clinic.clinicId,
    callSid: session.callSid,
    occurredAt: new Date().toISOString(),
    call: {
      phone: session.phone,
      durationSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1_000)),
    },
    patient: {
      // The current EDS typed contract requires this compatibility flag. EDS
      // still creates the patient when no name + date-of-birth match exists.
      existingPatient: true,
      firstName: names.firstName,
      lastName: names.lastName,
      birthDate: birthDateForEds(session.dateOfBirth || ''),
    },
    request: {
      // Reuse the existing EDS/Curo contract; the explicit text below lets
      // clinic staff distinguish this from an ordinary follow-up.
      type: 'follow_up',
      detail: [
        'PREDREGISTRÁCIA NOVÉHO PACIENTA pred otvorením ambulancie.',
        'Nejde o potvrdenú registráciu ani objednanie na vyšetrenie.',
        `Poisťovňa: ${healthInsurer}.`,
        `Bydlisko: ${municipality}.`,
        `Súhlas so zaznamenaním údajov a spätným kontaktom: áno (${consentRecordedAt}).`,
      ].join('\n'),
    },
  };
}

async function completePreRegistration(
  fastify: FastifyInstance,
  reply: FastifyReply,
  session: KutakovaSession
): Promise<FastifyReply> {
  try {
    const event = buildPreRegistrationEvent(session);
    const result = await neurocentrumEdsService.sendPatientRequest(event);
    fastify.log.info(
      { callSid: session.callSid, clinicId: event.clinicId, result },
      'MUDr. Kutakova pre-registration stored in EDS'
    );
    return simpleEnd(reply, kutakovaBotConfig.messages.completion);
  } catch (error) {
    fastify.log.error(
      { err: error, callSid: session.callSid, clinicId: kutakovaBotConfig.clinic.clinicId },
      'Failed to store MUDr. Kutakova pre-registration in EDS'
    );
    return simpleEnd(reply, kutakovaBotConfig.messages.technical);
  } finally {
    kutakovaSessionService.delete(session.callSid);
  }
}

export function startKutakovaVoiceBot(reply: FastifyReply, body: Record<string, string>): FastifyReply {
  const session = kutakovaSessionService.create(body.CallSid, body.From || '');
  if (!session) {
    return simpleEnd(reply, 'Všetky linky sú momentálne obsadené. Skúste, prosím, zavolať o chvíľu. Dovidenia.');
  }

  kutakovaSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/kutakova/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    numDigits: 1,
    hints: 'áno, nie',
  } as any);
  gather.say(sayOptions, kutakovaBotConfig.messages.greeting);
  gather.say(sayOptions, kutakovaBotConfig.messages.consent);
  twiml.redirect('/voice/kutakova/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

export function finalizeAbandonedKutakovaCall(callSid: string): boolean {
  return kutakovaSessionService.delete(callSid);
}

export async function kutakovaVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/kutakova/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kutakovaSessionService.get(body.CallSid);
    if (!session) return simpleEnd(reply, 'Platnosť hovoru vypršala. Zavolajte, prosím, znova.');
    session.attempts += 1;
    if (session.attempts >= 3) {
      kutakovaSessionService.delete(session.callSid);
      return simpleEnd(reply, kutakovaBotConfig.messages.technical);
    }
    return renderPrompt(reply, session, 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz. ');
  });

  fastify.post('/kutakova/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kutakovaSessionService.get(body.CallSid);
    if (!session) return simpleEnd(reply, 'Platnosť hovoru vypršala. Zavolajte, prosím, znova.');
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, 'Prepáčte, odpoveď som nezachytila. ');

    if (isNeurocentrumUrgent(answer)) {
      kutakovaSessionService.delete(session.callSid);
      return simpleEnd(reply, kutakovaBotConfig.messages.urgent);
    }

    if (session.step === 'consent') {
      const consent = parseNeurocentrumYesNo(answer);
      if (consent === undefined) return renderPrompt(reply, session, 'Odpovedzte, prosím, áno alebo nie. ');
      if (!consent) {
        kutakovaSessionService.delete(session.callSid);
        return simpleEnd(reply, kutakovaBotConfig.messages.declined);
      }
      session.consentRecordedAt = new Date().toISOString();
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session, 'Ďakujem. ');
    }

    if (session.step === 'name') {
      if (answer.split(/\s+/).filter(Boolean).length < 2) {
        return renderPrompt(reply, session, 'Potrebujeme meno aj priezvisko. ');
      }
      session.patientName = answer;
      session.attempts = 0;
      session.step = 'date_of_birth';
      return renderPrompt(reply, session, 'Ďakujem. ');
    }

    if (session.step === 'date_of_birth') {
      const dateOfBirth = normalizeNeurocentrumDateOfBirth(answer);
      if (!dateOfBirth) {
        return renderPrompt(reply, session, 'Dátum sa mi nepodarilo rozpoznať. ');
      }
      session.dateOfBirth = dateOfBirth;
      session.attempts = 0;
      session.step = 'health_insurer';
      return renderPrompt(reply, session, 'Rozumiem. ');
    }

    if (session.step === 'health_insurer') {
      const healthInsurer = parseKutakovaHealthInsurer(answer);
      if (!healthInsurer) return renderPrompt(reply, session, 'Poisťovňu sa mi nepodarilo rozpoznať. ');
      session.healthInsurer = healthInsurer;
      session.attempts = 0;
      session.step = 'municipality';
      return renderPrompt(reply, session, 'Ďakujem. ');
    }

    if (session.step === 'municipality') {
      if (answer.length < 2) return renderPrompt(reply, session, 'Obec alebo mesto sa mi nepodarilo rozpoznať. ');
      session.municipality = answer;
      session.attempts = 0;
      session.step = 'confirmation';
      return renderPrompt(reply, session);
    }

    if (session.step === 'confirmation') {
      const confirmed = parseNeurocentrumYesNo(answer);
      if (confirmed === undefined) return renderPrompt(reply, session, 'Odpovedzte, prosím, áno alebo nie. ');
      if (!confirmed) {
        kutakovaSessionService.delete(session.callSid);
        return simpleEnd(reply, 'Rozumiem. Údaje sme neodoslali. Pre opravu predregistrácie zavolajte, prosím, znova. Dovidenia.');
      }
      return completePreRegistration(fastify, reply, session);
    }

    kutakovaSessionService.delete(session.callSid);
    return simpleEnd(reply, kutakovaBotConfig.messages.technical);
  });
}
