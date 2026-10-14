import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import {
  elisseaBotConfig,
  ElisseaAppointmentType,
  ElisseaRequestType,
} from '../config/elissea.config';
import {
  extractElisseaBirthYear,
  parseElisseaAdministrativeType,
  parseElisseaAppointmentType,
  parseElisseaMainMenu,
  parseElisseaYesNo,
} from '../services/elissea-nlu.service';
import { ElisseaSession, elisseaSessionService } from '../services/elissea-session.service';
import { prixiService } from '../services/prixi.service';
import { VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, createVoiceEventKey, failVoiceEvent } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' };

const copy = {
  greeting: 'Dobrý deň, dovolali ste sa do Elissea Clinic, všeobecnej ambulancie pre dospelých. Ste už naším pacientom? Pre áno stlačte jednotku, pre nie stlačte dvojku.',
  name: 'Povedzte, prosím, vaše meno a priezvisko.',
  birthYear: 'Povedzte, prosím, váš rok narodenia.',
  mainMenu: 'Ak sa chcete objednať, stlačte jednotku. Ak potrebujete recept, pé en alebo informáciu o výsledkoch, stlačte dvojku. Ak potrebujete tlačivo alebo posudok, stlačte trojku. Ak potrebujete riešiť niečo iné, stlačte štvorku.',
  appointmentType: 'Pre akútne vyšetrenie stlačte jednotku. Pre kontrolné vyšetrenie stlačte dvojku. Pre odbery stlačte trojku. Pre očkovanie stlačte štvorku. Pre preventívnu prehliadku stlačte päťku.',
  administrativeType: 'Pre recept stlačte jednotku. Pre pé en stlačte dvojku. Pre výsledky stlačte trojku.',
  prescriptionDetail: 'Zreteľne povedzte názov lieku, jeho silu alebo gramáž a počet balení.',
  resultsDetail: 'Zreteľne povedzte, o aké výsledky žiadate.',
  certificateDetail: 'Zreteľne povedzte, o aké tlačivo alebo posudok žiadate.',
  otherDetail: 'Zreteľne povedzte, čo potrebujete. Ambulancia vás bude následne kontaktovať.',
  newPatientDetail: 'Pár vetami opíšte, čo potrebujete. Vašu požiadavku spracujeme a ambulancia vás bude následne kontaktovať.',
  retry: 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz. ',
  expired: 'Hovor sa nepodarilo dokončiť. Zavolajte, prosím, znova. Dovidenia.',
  technical: 'Momentálne máme technické problémy. Skúste, prosím, zavolať neskôr. Dovidenia.',
  sickLeave: 'Pre vystavenie pé en je najprv nutné objednať sa na vyšetrenie, aby lekár osobne posúdil váš zdravotný stav.',
};

const requestLabels: Record<ElisseaRequestType, string> = {
  appointment: 'objednanie na vyšetrenie',
  prescription: 'recept',
  sick_leave: 'PN – objednanie na akútne vyšetrenie',
  results: 'výsledky vyšetrenia',
  certificate: 'tlačivo alebo posudok',
  other: 'iná požiadavka',
  new_patient: 'požiadavka nového pacienta',
};

const appointmentLabels: Record<ElisseaAppointmentType, string> = {
  acute_exam: 'akútne vyšetrenie',
  control_exam: 'kontrolné vyšetrenie',
  blood_draw: 'odbery',
  vaccination: 'očkovanie',
  preventive_exam: 'preventívna prehliadka',
};

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function promptFor(session: ElisseaSession): string {
  switch (session.step) {
    case 'existing_patient': return copy.greeting;
    case 'name': return copy.name;
    case 'birth_year': return copy.birthYear;
    case 'main_menu': return copy.mainMenu;
    case 'appointment_type': return copy.appointmentType;
    case 'administrative_type': return copy.administrativeType;
    case 'detail':
      if (session.requestType === 'prescription') return copy.prescriptionDetail;
      if (session.requestType === 'results') return copy.resultsDetail;
      if (session.requestType === 'certificate') return copy.certificateDetail;
      if (session.requestType === 'new_patient') return copy.newPatientDetail;
      return copy.otherDetail;
  }
}

function renderPrompt(reply: FastifyReply, session: ElisseaSession, prefix = ''): FastifyReply {
  elisseaSessionService.save(session);
  const twiml = new VoiceResponse();
  const isMenu = ['existing_patient', 'main_menu', 'appointment_type', 'administrative_type'].includes(session.step);
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/elissea/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: 'sk-SK',
    ...(isMenu ? { numDigits: 1 } : {}),
  } as any);
  gather.say(sayOptions, `${prefix}${promptFor(session)}`.trim());
  twiml.redirect('/voice/elissea/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderEnd(reply: FastifyReply, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

async function resolveClinicId(): Promise<string> {
  const config = await prixiService.getConfig(elisseaBotConfig.clinic.inboundTwilioNumber);
  const clinicId = String(config.clinicId ?? '').trim();
  if (config.voiceBotEnabled !== true || clinicId !== elisseaBotConfig.clinic.clinicId) {
    throw new Error(`Blocked Elissea route: expected clinic 148, received ${clinicId || '<missing>'}`);
  }
  return clinicId;
}

function requestSummary(session: ElisseaSession): string {
  if (session.requestType === 'appointment' || session.requestType === 'sick_leave') {
    return `Pacient žiada ${session.appointmentType ? appointmentLabels[session.appointmentType] : 'termín vyšetrenia'}. Konkrétny termín nebol rezervovaný; ambulancia má pacienta kontaktovať.`;
  }
  if (session.requestType === 'prescription') return `Požiadavka na recept: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'results') return `Požadované výsledky: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'certificate') return `Požadované tlačivo alebo posudok: ${session.detail || 'detail nebol dokončený'}.`;
  if (session.requestType === 'new_patient') return `Nový pacient žiada: ${session.detail || 'detail nebol dokončený'}.`;
  return `Iná požiadavka: ${session.detail || 'detail nebol dokončený'}.`;
}

function buildProblemTranscript(session: ElisseaSession): string {
  const answers = session.answers.map(answer => `${answer.step}: ${answer.text}`).join(' | ');
  return [
    '[Voice-bot Elissea Clinic]',
    `Stav hovoru: ${session.outcome === 'abandoned' ? 'NEDOKONČENÝ – volajúci zložil pred ukončením flow' : 'dokončený'}`,
    `Pacient ambulancie: ${session.existingPatient === true ? 'áno' : session.existingPatient === false ? 'nie' : 'nezistené'}`,
    `Kategória: ${session.requestType ? requestLabels[session.requestType] : 'nezistená'}`,
    ...(session.appointmentType ? [`Typ termínu: ${appointmentLabels[session.appointmentType]}`] : []),
    `Telefón: ${session.phone}`,
    `Meno a priezvisko: ${session.patientName || 'neuvedené'}`,
    `Rok narodenia: ${session.birthYear || 'neuvedený'}`,
    `**Zhrnutie:** ${requestSummary(session)}`,
    ...(session.outcome === 'abandoned' ? [`Posledný krok: ${session.step}`] : []),
    `Prepis odpovedí: ${answers}`,
  ].join('\n');
}

function closingMessage(session: ElisseaSession): string {
  if (session.requestType === 'appointment' || session.requestType === 'sick_leave') {
    return 'Ďakujem. Vašu požiadavku na vyšetrenie sme zaznamenali. Ambulancia vás bude kontaktovať s ponukou termínu. Konkrétny termín zatiaľ nebol rezervovaný. Prajem pekný zvyšok dňa.';
  }
  if (session.requestType === 'prescription' || session.requestType === 'results') {
    return 'Ďakujem. Vaša požiadavka bola zaznamenaná. Ambulancia vás bude informovať o jej vybavení. Prajem pekný deň.';
  }
  return 'Ďakujem. Vašu požiadavku sme zaznamenali a ambulancia vás bude kontaktovať ohľadom ďalšieho postupu. Prajem pekný deň.';
}

function hasMeaningfulRequest(session: ElisseaSession): boolean {
  return Boolean(session.requestType || session.detail);
}

function dispatchRequest(fastify: FastifyInstance, session: ElisseaSession, onSuccess?: () => void): boolean {
  if (!hasMeaningfulRequest(session)) return false;
  const endedAt = session.endedAt || new Date().toISOString();
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000));
  const event: VoicemailRecordedEvent = {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: elisseaBotConfig.clinic.inboundTwilioNumber,
    durationSeconds,
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
  const eventKey = createVoiceEventKey('voicemail_recorded', session.callSid);
  if (!claimVoiceEvent(eventKey)) return false;
  prixiService.sendEvent(event, 3, eventKey)
    .then(() => {
      completeVoiceEvent(eventKey);
      onSuccess?.();
    })
    .catch(error => {
      failVoiceEvent(eventKey);
      fastify.log.error(error, 'Failed to create Elissea PriXi request');
    });
  return true;
}

function completeCall(fastify: FastifyInstance, reply: FastifyReply, session: ElisseaSession, prefix = ''): FastifyReply {
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  dispatchRequest(fastify, session);
  elisseaSessionService.delete(session.callSid);
  return renderEnd(reply, `${prefix}${closingMessage(session)}`.trim());
}

export async function startElisseaVoiceBot(
  fastify: FastifyInstance,
  reply: FastifyReply,
  body: Record<string, string>
): Promise<FastifyReply> {
  try {
    const clinicId = await resolveClinicId();
    return renderPrompt(reply, elisseaSessionService.create(body.CallSid, body.From || '', clinicId));
  } catch (error) {
    fastify.log.error(error, 'Elissea clinic routing validation failed');
    return renderEnd(reply, copy.technical);
  }
}

export function finalizeAbandonedElisseaCall(
  fastify: FastifyInstance,
  callSid: string,
  endedAt: string = new Date().toISOString()
): boolean {
  const session = elisseaSessionService.get(callSid);
  if (!session) return false;
  if (!hasMeaningfulRequest(session)) {
    elisseaSessionService.delete(callSid);
    return false;
  }
  session.outcome = 'abandoned';
  session.endedAt = endedAt;
  elisseaSessionService.save(session);
  return dispatchRequest(fastify, session, () => elisseaSessionService.delete(callSid));
}

export async function elisseaVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/elissea/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = elisseaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    session.attempts += 1;
    if (session.attempts >= 3) {
      finalizeAbandonedElisseaCall(fastify, session.callSid);
      return renderEnd(reply, copy.expired);
    }
    return renderPrompt(reply, session, copy.retry);
  });

  fastify.post('/elissea/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = elisseaSessionService.get(body.CallSid);
    if (!session) return renderEnd(reply, copy.expired);
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, copy.retry);
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'existing_patient') {
      const existing = parseElisseaYesNo(answer);
      if (existing === undefined) return renderPrompt(reply, session, copy.retry);
      session.existingPatient = existing;
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
      const birthYear = extractElisseaBirthYear(answer);
      if (!birthYear && session.attempts < 1) {
        session.attempts += 1;
        return renderPrompt(reply, session, copy.retry);
      }
      session.birthYear = birthYear || answer;
      session.attempts = 0;
      if (session.existingPatient) {
        session.step = 'main_menu';
      } else {
        session.requestType = 'new_patient';
        session.step = 'detail';
      }
      return renderPrompt(reply, session);
    }

    if (session.step === 'main_menu') {
      const selection = parseElisseaMainMenu(answer);
      if (!selection) return renderPrompt(reply, session, copy.retry);
      session.attempts = 0;
      if (selection === 'appointment') {
        session.requestType = 'appointment';
        session.step = 'appointment_type';
      } else if (selection === 'administrative') {
        session.step = 'administrative_type';
      } else {
        session.requestType = selection;
        session.step = 'detail';
      }
      return renderPrompt(reply, session);
    }

    if (session.step === 'appointment_type') {
      const appointmentType = parseElisseaAppointmentType(answer);
      if (!appointmentType) return renderPrompt(reply, session, copy.retry);
      session.appointmentType = appointmentType;
      return completeCall(fastify, reply, session);
    }

    if (session.step === 'administrative_type') {
      const requestType = parseElisseaAdministrativeType(answer);
      if (!requestType) return renderPrompt(reply, session, copy.retry);
      session.requestType = requestType;
      if (requestType === 'sick_leave') {
        session.appointmentType = 'acute_exam';
        return completeCall(fastify, reply, session, `${copy.sickLeave} `);
      }
      session.step = 'detail';
      return renderPrompt(reply, session);
    }

    if (session.step === 'detail') {
      session.detail = answer;
      return completeCall(fastify, reply, session);
    }

    return renderPrompt(reply, session, copy.retry);
  });
}
