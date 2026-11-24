import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import twilio from 'twilio';
import { kutakovaBotConfig, KutakovaLanguage } from '../config/kutakova.config';
import {
  isKutakovaUrgent,
  normalizeKutakovaDateOfBirth,
  parseKutakovaHealthInsurer,
  parseKutakovaLanguage,
  parseKutakovaYesNo,
} from '../services/kutakova-nlu.service';
import { KutakovaSession, kutakovaSessionService } from '../services/kutakova-session.service';
import { PreRegistrationPatientRequestEvent, neurocentrumEdsService } from '../services/neurocentrum-eds.service';
import { prixiService } from '../services/prixi.service';
import { ClinicConfig } from '../types';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: Record<KutakovaLanguage, Record<string, any>> = {
  sk: { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' },
  en: { language: 'en-US', voice: 'Google.en-US-Wavenet-F' },
};

const copy = {
  sk: {
    languagePrompt: 'Dobrý deň. Pre slovenčinu povedzte slovensky alebo stlačte jednotku.',
    languageRetry: 'Jazyk sa mi nepodarilo rozpoznať. Pre slovenčinu stlačte jednotku.',
    consent: kutakovaBotConfig.messages.consent,
    declined: kutakovaBotConfig.messages.declined,
    name: 'Povedzte, prosím, svoje meno a priezvisko.',
    dateOfBirth: 'Povedzte, prosím, svoj celý dátum narodenia, napríklad pätnásteho marca 1980.',
    insurer: 'V ktorej zdravotnej poisťovni ste poistený? Pre Všeobecnú zdravotnú poisťovňu povedzte Všeobecná alebo stlačte jednotku. Pre Dôveru povedzte Dôvera alebo stlačte dvojku. Pre Union povedzte Union alebo stlačte trojku. Ak máte inú poisťovňu alebo si nie ste istý, stlačte štvorku.',
    municipality: 'Povedzte, prosím, obec alebo mesto svojho bydliska. Úplnú adresu od vás teraz nepotrebujeme.',
    retry: 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz. ',
    yesNoRetry: 'Odpovedzte, prosím, áno alebo nie. ',
    nameRetry: 'Potrebujeme meno aj priezvisko. ',
    dateRetry: 'Dátum sa mi nepodarilo rozpoznať. ',
    insurerRetry: 'Poisťovňu sa mi nepodarilo rozpoznať. ',
    municipalityRetry: 'Obec alebo mesto sa mi nepodarilo rozpoznať. ',
    thanks: 'Ďakujem. ',
    understood: 'Rozumiem. ',
    correction: 'Rozumiem. Údaje sme neodoslali. Pre opravu predregistrácie zavolajte, prosím, znova. Dovidenia.',
    expired: 'Platnosť hovoru vypršala. Zavolajte, prosím, znova.',
    busy: 'Všetky linky sú momentálne obsadené. Skúste, prosím, zavolať o chvíľu. Dovidenia.',
    outsideHours: 'Momentálne sme mimo ordinačných hodín. Predregistráciu však môžete vybaviť prostredníctvom telefonickej asistentky PriXi.',
  },
  en: {
    languagePrompt: 'For English, say English or press two.',
    languageRetry: 'I could not recognize the language. For English, press two.',
    greeting: 'Hello. You have reached the future general practice of Doctor Kutakova. The practice is planned to open in December. You can use this line to request pre-registration. Pre-registration is not yet a confirmed registration or a medical appointment.',
    consent: 'Do you agree that we may record the information you provide for pre-registration and that the practice may contact you on the phone number you are calling from? Say yes or press one. If you do not agree, say no or press two.',
    declined: 'Understood. We will not record your information without your consent. Please call again if you wish to continue. Goodbye.',
    name: 'Please say your first name and surname.',
    dateOfBirth: 'Please say your full date of birth, for example March fifteenth 1980.',
    insurer: 'Which health insurance company are you insured with? For the General Health Insurance Company, say General or press one. For Dovera, say Dovera or press two. For Union, say Union or press three. If you have another insurer or are not sure, press four.',
    municipality: 'Please say the town or municipality where you live. We do not need your full address at this time.',
    retry: 'Sorry, I did not catch your answer. Please try again. ',
    yesNoRetry: 'Please answer yes or no. ',
    nameRetry: 'We need both your first name and surname. ',
    dateRetry: 'I could not recognize the date. ',
    insurerRetry: 'I could not recognize the health insurance company. ',
    municipalityRetry: 'I could not recognize the town or municipality. ',
    thanks: 'Thank you. ',
    understood: 'Understood. ',
    correction: 'Understood. We have not submitted the information. To correct your pre-registration, please call again. Goodbye.',
    expired: 'This call has expired. Please call again.',
    busy: 'All lines are currently busy. Please call again in a few moments. Goodbye.',
    outsideHours: 'The practice is currently outside its office hours. You can still complete pre-registration with the PriXi telephone assistant.',
    completion: 'Thank you. We have securely recorded your pre-registration request. This is not yet a confirmed registration. The practice will contact you on the phone number you are calling from to agree on the next steps. Goodbye.',
    technical: 'We could not securely save your pre-registration at this time. Please call again later. Goodbye.',
    urgent: 'This line is not intended for acute medical problems. If this is a sudden life-threatening emergency, call 155 or 112.',
    vacation: 'The practice is currently unavailable. Please call again later. Goodbye.',
    disabled: 'The telephone assistant is currently unavailable. Please call again later. Goodbye.',
  },
};

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function languageOf(session: KutakovaSession): KutakovaLanguage {
  return session.language || 'sk';
}

function configuredMessage(session: KutakovaSession, key: string, fallback: string): string {
  if (languageOf(session) !== 'sk') return fallback;
  const configured = session.runtimeConfig?.messages?.[key];
  return typeof configured === 'string' && configured.trim() ? configured.trim() : fallback;
}

function simpleEnd(reply: FastifyReply, language: KutakovaLanguage, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions[language], message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function bilingualEnd(reply: FastifyReply, slovak: string, english: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions.sk, slovak);
  twiml.say(sayOptions.en, english);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

function renderLanguagePrompt(reply: FastifyReply, session: KutakovaSession, retry = false): FastifyReply {
  kutakovaSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/kutakova/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    hints: 'slovensky, po slovensky, English, anglicky',
    numDigits: 1,
  } as any);
  gather.say(sayOptions.sk, retry ? copy.sk.languageRetry : copy.sk.languagePrompt);
  gather.say(sayOptions.en, retry ? copy.en.languageRetry : copy.en.languagePrompt);
  twiml.redirect('/voice/kutakova/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function insurerForSpeech(session: KutakovaSession): string {
  const insurer = session.healthInsurer || '';
  if (languageOf(session) === 'sk') return insurer;
  if (insurer === 'Všeobecná zdravotná poisťovňa') return 'General Health Insurance Company';
  if (insurer === 'Iná alebo neuvedená') return 'other or unspecified';
  return insurer;
}

function promptFor(session: KutakovaSession): string {
  const language = languageOf(session);
  const text = copy[language];
  switch (session.step) {
    case 'language': return '';
    case 'consent': return text.consent;
    case 'name': return text.name;
    case 'date_of_birth': return text.dateOfBirth;
    case 'health_insurer': return text.insurer;
    case 'municipality': return text.municipality;
    case 'confirmation':
      return language === 'sk'
        ? `Zhrniem údaje. Meno ${session.patientName}. Dátum narodenia ${session.dateOfBirth}. Poisťovňa ${insurerForSpeech(session)}. Bydlisko ${session.municipality}. Sú údaje správne? Povedzte áno alebo stlačte jednotku. Ak nie sú správne, povedzte nie alebo stlačte dvojku.`
        : `I will summarize your information. Name ${session.patientName}. Date of birth ${session.dateOfBirth}. Health insurance ${insurerForSpeech(session)}. Town or municipality ${session.municipality}. Is this information correct? Say yes or press one. If it is not correct, say no or press two.`;
  }
}

function renderPrompt(reply: FastifyReply, session: KutakovaSession, prefix = ''): FastifyReply {
  if (session.step === 'language') return renderLanguagePrompt(reply, session, Boolean(prefix));
  kutakovaSessionService.save(session);
  const language = languageOf(session);
  const yesNo = session.step === 'consent' || session.step === 'confirmation';
  const insurer = session.step === 'health_insurer';
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/kutakova/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: language === 'en' ? 'en-US' : 'sk-SK',
    ...(yesNo ? { numDigits: 1, hints: language === 'en' ? 'yes, no' : 'áno, nie' } : {}),
    ...(insurer ? { numDigits: 1, hints: 'Všeobecná zdravotná poisťovňa, General Health Insurance Company, Dôvera, Union' } : {}),
  } as any);
  gather.say(sayOptions[language], `${prefix}${promptFor(session)}`.trim());
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

function buildPreRegistrationEvent(session: KutakovaSession): PreRegistrationPatientRequestEvent {
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
      existingPatient: false,
      firstName: names.firstName,
      lastName: names.lastName,
      birthDate: birthDateForEds(session.dateOfBirth || ''),
    },
    request: {
      type: 'pre_registration',
      detail: [
        'PREDREGISTRÁCIA NOVÉHO PACIENTA pred otvorením ambulancie.',
        'Nejde o potvrdenú registráciu ani objednanie na vyšetrenie.',
        `Jazyk hovoru: ${languageOf(session).toUpperCase()}.`,
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
  const language = languageOf(session);
  try {
    const event = buildPreRegistrationEvent(session);
    const result = await neurocentrumEdsService.sendPatientRequest(event);
    fastify.log.info(
      { callSid: session.callSid, clinicId: event.clinicId, language, result },
      'MUDr. Kutakova pre-registration stored in EDS'
    );
    return simpleEnd(
      reply,
      language,
      configuredMessage(session, 'completion', language === 'en' ? copy.en.completion : kutakovaBotConfig.messages.completion)
    );
  } catch (error) {
    fastify.log.error(
      { err: error, callSid: session.callSid, clinicId: kutakovaBotConfig.clinic.clinicId },
      'Failed to store MUDr. Kutakova pre-registration in EDS'
    );
    return simpleEnd(
      reply,
      language,
      configuredMessage(session, 'technical', language === 'en' ? copy.en.technical : kutakovaBotConfig.messages.technical)
    );
  } finally {
    kutakovaSessionService.delete(session.callSid);
  }
}

async function loadRuntimeConfig(fastify: FastifyInstance): Promise<ClinicConfig | undefined> {
  try {
    const config = await prixiService.getVoiceAssistantConfig(kutakovaBotConfig.clinic.inboundTwilioNumber);
    const clinicId = String(config.clinicId ?? '').trim();
    if (clinicId !== kutakovaBotConfig.clinic.clinicId || config.assistantType !== 'kutakova') {
      fastify.log.warn(
        { clinicId, assistantType: config.assistantType },
        'MUDr. Kutakova runtime configuration is not assigned yet; using safe code fallback'
      );
      return undefined;
    }
    return config;
  } catch (error) {
    fastify.log.warn({ err: error }, 'Failed to load MUDr. Kutakova runtime configuration; using safe code fallback');
    return undefined;
  }
}

export async function startKutakovaVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  const runtimeConfig = await loadRuntimeConfig(fastify);
  if (runtimeConfig && (runtimeConfig.enabled === false || runtimeConfig.voiceBotEnabled === false || runtimeConfig.availability?.status === 'disabled')) {
    return bilingualEnd(
      reply,
      runtimeConfig.messages?.technical?.trim() || kutakovaBotConfig.messages.technical,
      copy.en.disabled
    );
  }
  if (runtimeConfig?.availability?.status === 'vacation') {
    return bilingualEnd(
      reply,
      runtimeConfig.availability.message?.trim() || runtimeConfig.messages?.vacation?.trim() || 'Ambulancia je momentálne nedostupná. Skúste, prosím, zavolať neskôr. Dovidenia.',
      copy.en.vacation
    );
  }

  const session = kutakovaSessionService.create(body.CallSid, body.From || '', runtimeConfig);
  if (!session) return bilingualEnd(reply, copy.sk.busy, copy.en.busy);
  return renderLanguagePrompt(reply, session);
}

export function finalizeAbandonedKutakovaCall(callSid: string): boolean {
  return kutakovaSessionService.delete(callSid);
}

function localizedPrefix(session: KutakovaSession, slovak: string, english: string): string {
  return languageOf(session) === 'en' ? english : slovak;
}

export async function kutakovaVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/kutakova/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kutakovaSessionService.get(body.CallSid);
    if (!session) return bilingualEnd(reply, copy.sk.expired, copy.en.expired);
    session.attempts += 1;
    if (session.attempts >= 3) {
      kutakovaSessionService.delete(session.callSid);
      const language = languageOf(session);
      return simpleEnd(
        reply,
        language,
        configuredMessage(session, 'technical', language === 'en' ? copy.en.technical : kutakovaBotConfig.messages.technical)
      );
    }
    return renderPrompt(reply, session, localizedPrefix(session, copy.sk.retry, copy.en.retry));
  });

  fastify.post('/kutakova/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = kutakovaSessionService.get(body.CallSid);
    if (!session) return bilingualEnd(reply, copy.sk.expired, copy.en.expired);
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, localizedPrefix(session, copy.sk.retry, copy.en.retry));

    if (isKutakovaUrgent(answer)) {
      kutakovaSessionService.delete(session.callSid);
      const language = languageOf(session);
      return simpleEnd(
        reply,
        language,
        configuredMessage(session, 'urgent', language === 'en' ? copy.en.urgent : kutakovaBotConfig.messages.urgent)
      );
    }

    if (session.step === 'language') {
      const language = parseKutakovaLanguage(answer);
      if (!language) return renderLanguagePrompt(reply, session, true);
      session.language = language;
      session.attempts = 0;
      session.step = 'consent';
      const greeting = language === 'en'
        ? copy.en.greeting
        : configuredMessage(session, 'greeting', kutakovaBotConfig.messages.greeting);
      const outsideHours = session.outsideHours
        ? ` ${configuredMessage(session, 'afterHours', language === 'en' ? copy.en.outsideHours : copy.sk.outsideHours)}`
        : '';
      return renderPrompt(reply, session, `${greeting}${outsideHours} `);
    }

    const language = languageOf(session);
    const text = copy[language];

    if (session.step === 'consent') {
      const consent = parseKutakovaYesNo(answer);
      if (consent === undefined) return renderPrompt(reply, session, text.yesNoRetry);
      if (!consent) {
        kutakovaSessionService.delete(session.callSid);
        return simpleEnd(reply, language, text.declined);
      }
      session.consentRecordedAt = new Date().toISOString();
      session.attempts = 0;
      session.step = 'name';
      return renderPrompt(reply, session, text.thanks);
    }

    if (session.step === 'name') {
      if (answer.split(/\s+/).filter(Boolean).length < 2) return renderPrompt(reply, session, text.nameRetry);
      session.patientName = answer;
      session.attempts = 0;
      session.step = 'date_of_birth';
      return renderPrompt(reply, session, text.thanks);
    }

    if (session.step === 'date_of_birth') {
      const dateOfBirth = normalizeKutakovaDateOfBirth(answer, language);
      if (!dateOfBirth) return renderPrompt(reply, session, text.dateRetry);
      session.dateOfBirth = dateOfBirth;
      session.attempts = 0;
      session.step = 'health_insurer';
      return renderPrompt(reply, session, text.understood);
    }

    if (session.step === 'health_insurer') {
      const healthInsurer = parseKutakovaHealthInsurer(answer);
      if (!healthInsurer) return renderPrompt(reply, session, text.insurerRetry);
      session.healthInsurer = healthInsurer;
      session.attempts = 0;
      session.step = 'municipality';
      return renderPrompt(reply, session, text.thanks);
    }

    if (session.step === 'municipality') {
      if (answer.length < 2) return renderPrompt(reply, session, text.municipalityRetry);
      session.municipality = answer;
      session.attempts = 0;
      session.step = 'confirmation';
      return renderPrompt(reply, session);
    }

    if (session.step === 'confirmation') {
      const confirmed = parseKutakovaYesNo(answer);
      if (confirmed === undefined) return renderPrompt(reply, session, text.yesNoRetry);
      if (!confirmed) {
        kutakovaSessionService.delete(session.callSid);
        return simpleEnd(reply, language, text.correction);
      }
      return completePreRegistration(fastify, reply, session);
    }

    kutakovaSessionService.delete(session.callSid);
    return simpleEnd(
      reply,
      language,
      configuredMessage(session, 'technical', language === 'en' ? copy.en.technical : kutakovaBotConfig.messages.technical)
    );
  });
}
