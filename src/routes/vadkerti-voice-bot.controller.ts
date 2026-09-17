import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import twilio from 'twilio';
import { vadkertiBotConfig, VadkertiLanguage, VadkertiRequestType } from '../config/vadkerti.config';
import { prixiService } from '../services/prixi.service';
import {
  extractBirthYear,
  isSocialPurposeReport,
  isVadkertiUrgent,
  parseAppointmentAction,
  parseVadkertiIntent,
  parseVadkertiLanguage,
  parseVadkertiYesNo,
} from '../services/vadkerti-nlu.service';
import { VadkertiSession, vadkertiSessionService } from '../services/vadkerti-session.service';
import { VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, createVoiceEventKey, failVoiceEvent } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;
const UNRESOLVED_CLINIC_IDS = new Set(['', 'orphan', 'fallback']);

const categoryLabels: Record<VadkertiRequestType, string> = {
  new_patient_no_neurologist: 'nový pacient / ešte nebol u neurológa',
  new_to_clinic_seen_neurologist: 'nový pacient v tejto ambulancii / už vyšetrovaný neurológom',
  existing_patient_follow_up: 'kontrola existujúceho pacienta',
  follow_up_with_results: 'kontrola s výsledkom vyšetrenia',
  procedure_or_therapy: 'výkon / terapia',
  prescription: 'recept',
  medical_report: 'predĺženie / vystavenie nálezu',
  appointment_change_or_cancellation: 'zmena / zrušenie termínu',
  other: 'iná požiadavka',
};

const sayOptions: Record<VadkertiLanguage, any> = {
  sk: { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' },
  hu: { language: 'hu-HU', voice: 'Google.hu-HU-Wavenet-A' },
};

function sayWithClinicPronunciation(
  target: { say: (options: any, message?: string) => any },
  language: VadkertiLanguage,
  message: string
): void {
  // Slovak Google TTS softens "ti" in the foreign surname. The phonetic
  // spelling is used only in synthesized speech; stored data keeps Vadkerti.
  const spokenMessage = language === 'sk'
    ? message.replace(/Vadkertiho/gu, 'Vadkertyho')
    : message;
  target.say(sayOptions[language], spokenMessage);
}

const text = {
  sk: {
    expired: 'Platnosť hovoru vypršala. Zavolajte, prosím, znova.',
    technical: 'Momentálne máme technické problémy. Skúste, prosím, zavolať neskôr.',
    afterHours: 'Telefonické požiadavky ambulancia prijíma v pracovné dni od siedmej tridsať do dvanástej. Kontaktujte nás, prosím, nasledujúci pracovný deň. Ďakujeme a dovidenia.',
    intent: 'Stručne mi, prosím, povedzte, čo potrebujete. Napríklad termín alebo kontrolu, výsledok vyšetrenia, výkon, recept, nález, alebo zmenu termínu.',
    currentClinic: 'Boli ste už vyšetrený v tejto aktuálnej ambulancii doktora Vadkertiho? Odpovedzte áno alebo nie.',
    priorNeurologist: 'Boli ste už niekedy vyšetrovaný iným neurológom? Odpovedzte áno alebo nie.',
    resultDetail: 'O aký výsledok vyšetrenia ide? Napríklad CT, MRI, EMG alebo EEG.',
    procedureDetail: 'Aký konkrétny výkon potrebujete? Napríklad USG karotíd, USG kĺbov, obstrek alebo kinesiotape.',
    prescriptionDetail: 'Ktoré lieky alebo recept potrebujete?',
    reportDetail: 'Stručne povedzte, o aké predĺženie alebo vystavenie nálezu ide.',
    otherDetail: 'Stručne povedzte, čo pre vás má ambulancia vybaviť.',
    appointmentAction: 'Chcete termín zmeniť alebo zrušiť?',
    appointmentDatetime: 'Povedzte, prosím, dátum a čas pôvodného termínu, ak ho poznáte.',
    name: 'Prosím, povedzte vaše meno a priezvisko.',
    birthYear: 'Prosím, povedzte váš rok narodenia.',
    retry: 'Prepáčte, odpoveď som nezachytila. Skúste to, prosím, ešte raz.',
    urgent: 'Ak ide o náhly alebo život ohrozujúci stav, nepokračujte v tomto hovore. Okamžite volajte tiesňovú linku 155 alebo 112. Dovidenia.',
  },
  hu: {
    expired: 'A hívás érvényessége lejárt. Kérjük, hívjon újra.',
    technical: 'Jelenleg technikai problémánk van. Kérjük, próbálja meg később.',
    afterHours: 'A rendelő telefonos kérelmeket munkanapokon fél nyolctól délig fogad. Kérjük, hívjon a következő munkanapon. Köszönjük, viszontlátásra.',
    intent: 'Kérem, röviden mondja el, miben segíthetünk. Például időpont vagy kontroll, vizsgálati eredmény, kezelés, recept, lelet, illetve időpont módosítása.',
    currentClinic: 'Volt már vizsgálaton Vadkerti doktor jelenlegi rendelőjében? Válaszoljon igennel vagy nemmel.',
    priorNeurologist: 'Vizsgálta már korábban más neurológus? Válaszoljon igennel vagy nemmel.',
    resultDetail: 'Milyen vizsgálati eredményről van szó? Például CT, MRI, EMG vagy EEG.',
    procedureDetail: 'Milyen konkrét vizsgálatot vagy kezelést kér? Például nyaki ér ultrahangot, ízületi ultrahangot, injekciót vagy kinesiotape kezelést.',
    prescriptionDetail: 'Melyik gyógyszerre vagy receptre van szüksége?',
    reportDetail: 'Röviden mondja el, milyen orvosi lelet meghosszabbítását vagy kiállítását kéri.',
    otherDetail: 'Röviden mondja el, mit kér a rendelőtől.',
    appointmentAction: 'Módosítani vagy lemondani szeretné az időpontot?',
    appointmentDatetime: 'Kérem, mondja meg az eredeti időpont dátumát és idejét, ha ismeri.',
    name: 'Kérem, mondja meg a teljes nevét.',
    birthYear: 'Kérem, mondja meg a születési évét.',
    retry: 'Elnézést, nem értettem a választ. Kérem, próbálja meg újra.',
    urgent: 'Ha hirtelen kialakult vagy életveszélyes állapotról van szó, ne folytassa ezt a hívást. Azonnal hívja a 155-ös vagy a 112-es segélyhívót. Viszontlátásra.',
  },
};

export function isVadkertiWithinBusinessHours(now?: DateTime): boolean {
  const localNow = (now || DateTime.now()).setZone(vadkertiBotConfig.clinic.timezone);
  if (!localNow.isValid) return false;
  if (vadkertiBotConfig.closedDates.includes(localNow.toISODate() || '')) return false;
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const hours = vadkertiBotConfig.businessHours[dayNames[localNow.weekday - 1]];
  if (!hours) return false;
  const [fromHour, fromMinute] = hours.from.split(':').map(Number);
  const [toHour, toMinute] = hours.to.split(':').map(Number);
  const from = localNow.set({ hour: fromHour, minute: fromMinute, second: 0, millisecond: 0 });
  const to = localNow.set({ hour: toHour, minute: toMinute, second: 0, millisecond: 0 });
  return localNow >= from && localNow < to;
}

function answerFrom(request: FastifyRequest): string {
  const body = request.body as Record<string, string>;
  return (body.SpeechResult || body.Digits || '').trim();
}

function renderLanguagePrompt(reply: FastifyReply, session: VadkertiSession): FastifyReply {
  vadkertiSessionService.save(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/vadkerti/answer',
    method: 'POST',
    timeout: 5,
    speechTimeout: 'auto',
    language: 'sk-SK',
    hints: 'slovensky, po slovensky, magyarul, po maďarsky',
    numDigits: 1,
  } as any);
  sayWithClinicPronunciation(gather, 'sk', 'Dobrý deň, dovolali ste sa do neurologickej ambulancie doktora Petra Vadkertiho. Pre slovenčinu povedzte slovensky alebo stlačte jednotku.');
  gather.say(sayOptions.hu, 'Jó napot kívánok, Vadkerti Péter doktor neurológiai rendelőjét hívta. Magyar nyelvhez mondja, hogy magyarul, vagy nyomja meg a kettes gombot.');
  twiml.redirect('/voice/vadkerti/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function promptFor(session: VadkertiSession): string {
  const language = session.language || 'sk';
  const copy = text[language];
  switch (session.step) {
    case 'intent': return copy.intent;
    case 'current_clinic': return copy.currentClinic;
    case 'prior_neurologist': return copy.priorNeurologist;
    case 'detail': {
      if (session.requestType === 'follow_up_with_results') return copy.resultDetail;
      if (session.requestType === 'procedure_or_therapy') return copy.procedureDetail;
      if (session.requestType === 'prescription') return copy.prescriptionDetail;
      if (session.requestType === 'medical_report') return copy.reportDetail;
      return copy.otherDetail;
    }
    case 'appointment_action': return copy.appointmentAction;
    case 'appointment_datetime': return copy.appointmentDatetime;
    case 'name': return copy.name;
    case 'birth_year': return copy.birthYear;
    default: return copy.retry;
  }
}

function renderPrompt(reply: FastifyReply, session: VadkertiSession, prefix = ''): FastifyReply {
  if (session.step === 'language') return renderLanguagePrompt(reply, session);
  const language = session.language || 'sk';
  vadkertiSessionService.save(session);
  const twiml = new VoiceResponse();
  const yesNo = session.step === 'current_clinic' || session.step === 'prior_neurologist';
  const action = session.step === 'appointment_action';
  const gather = twiml.gather({
    input: ['speech', 'dtmf'],
    action: '/voice/vadkerti/answer',
    method: 'POST',
    timeout: 6,
    speechTimeout: 'auto',
    language: language === 'hu' ? 'hu-HU' : 'sk-SK',
    ...(yesNo || action ? { numDigits: 1 } : {}),
    hints: yesNo
      ? language === 'hu' ? 'igen, nem' : 'áno, nie'
      : action
        ? language === 'hu' ? 'módosítani, lemondani' : 'zmeniť, zrušiť'
        : '',
  } as any);
  sayWithClinicPronunciation(gather, language, `${prefix}${promptFor(session)}`.trim());
  twiml.redirect('/voice/vadkerti/prompt');
  return reply.type('text/xml').send(twiml.toString());
}

function renderSimpleEnd(reply: FastifyReply, language: VadkertiLanguage, message: string): FastifyReply {
  const twiml = new VoiceResponse();
  sayWithClinicPronunciation(twiml, language, message);
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

async function resolveClinicId(): Promise<string> {
  const lookupNumbers = [
    vadkertiBotConfig.clinic.inboundTwilioNumber,
    vadkertiBotConfig.clinic.routingPhoneNumber,
  ];
  const failures: string[] = [];

  for (const phoneNumber of lookupNumbers) {
    const config = await prixiService.getConfig(phoneNumber);
    const clinicId = String(config.clinicId ?? '').trim();
    if (config.voiceBotEnabled === true && !UNRESOLVED_CLINIC_IDS.has(clinicId.toLowerCase())) {
      return clinicId;
    }
    failures.push(`${phoneNumber}: clinic=${clinicId || '<missing>'}, enabled=${config.voiceBotEnabled === true}`);
  }

  throw new Error(`Blocked unresolved or disabled Vadkerti clinic (${failures.join('; ')})`);
}

function moveAfterIntent(session: VadkertiSession, rawIntent: string): void {
  const intent = parseVadkertiIntent(rawIntent);
  if (!intent) {
    session.requestType = 'other';
    session.detail = rawIntent;
    session.step = 'name';
    return;
  }
  if (intent === 'appointment_history') {
    session.step = 'current_clinic';
    return;
  }
  session.requestType = intent;
  if (intent === 'prescription') {
    session.step = 'current_clinic';
  } else if (intent === 'follow_up_with_results' || intent === 'procedure_or_therapy' || intent === 'medical_report' || intent === 'other') {
    session.step = 'detail';
  } else if (intent === 'appointment_change_or_cancellation') {
    session.appointmentAction = parseAppointmentAction(rawIntent);
    session.step = session.appointmentAction ? 'appointment_datetime' : 'appointment_action';
  } else {
    session.step = 'name';
  }
}

function requestSummary(session: VadkertiSession): string {
  switch (session.requestType) {
    case 'new_patient_no_neurologist': return 'Žiadosť o neurologické vyšetrenie; pacient ešte nikdy nebol vyšetrený neurológom. Konkrétny termín nebol pridelený.';
    case 'new_to_clinic_seen_neurologist': return 'Žiadosť o neurologické vyšetrenie; pacient už bol vyšetrovaný neurológom, ale nie v aktuálnej ambulancii. Konkrétny termín nebol pridelený.';
    case 'existing_patient_follow_up': return 'Existujúci pacient aktuálnej ambulancie žiada kontrolu. Konkrétny termín nebol pridelený.';
    case 'follow_up_with_results': return `Kontrola s výsledkom vyšetrenia: ${session.detail || 'neuvedené'}. Konkrétny termín nebol pridelený.`;
    case 'procedure_or_therapy': return `Požadovaný výkon alebo terapia: ${session.detail || 'neuvedené'}. Konkrétny termín nebol pridelený.`;
    case 'prescription': return `${session.prescriptionEligible ? 'Pacient potvrdil, že už tu bol v minulosti vyšetrený.' : 'Pacient NEBOL vyšetrený v aktuálnej ambulancii; recept týmto flowom nie je automaticky oprávnený.'} Požiadavka: ${session.detail || 'neuvedené'}.`;
    case 'medical_report': return `Požiadavka na nález: ${session.detail || 'neuvedené'}.${isSocialPurposeReport(session.detail || '') ? ' Sociálny/posudkový účel – pacient bol upozornený na spoplatnenie podľa cenníka VÚC.' : ''}`;
    case 'appointment_change_or_cancellation': return `Pacient chce termín ${session.appointmentAction === 'cancel' ? 'zrušiť' : 'zmeniť'}. Pôvodný termín: ${session.originalAppointment || 'pacient ho neuviedol'}. Bot termín v Curo nezmenil ani nezrušil.`;
    case 'other': return `Iná požiadavka: ${session.detail || 'neuvedené'}.`;
    default: return session.outcome === 'abandoned'
      ? 'Pacient uviedol požiadavku, ale hovor ukončil pred dokončením triáže.'
      : 'Nezaradená telefonická požiadavka.';
  }
}

function buildProblemTranscript(session: VadkertiSession): string {
  const transcript = session.answers.map((answer) => `${answer.step}: ${answer.text}`).join(' | ');
  const category = session.requestType
    ? categoryLabels[session.requestType]
    : session.outcome === 'abandoned'
      ? 'nedokončená požiadavka – čaká na manuálne dotriedenie'
      : 'nezistená';
  return [
    '[Voice-bot MUDr. Peter Vadkerti]',
    `Stav hovoru: ${session.outcome === 'abandoned' ? 'NEDOKONČENÝ – volajúci zložil pred ukončením flow' : 'dokončený'}`,
    `Kategória: ${category}`,
    `Jazyk hovoru: ${session.language === 'hu' ? 'HU' : 'SK'}`,
    `Telefón: ${session.phone}`,
    `Meno: ${session.patientName || 'neuvedené'}`,
    `Rok narodenia: ${session.birthYear || 'neuvedený'}`,
    `**Zhrnutie:** ${requestSummary(session)}`,
    ...(session.outcome === 'abandoned' ? [`Posledný krok: ${session.step}`] : []),
    `Prepis odpovedí: ${transcript}`,
  ].join('\n');
}

function closingMessage(session: VadkertiSession): string {
  const language = session.language || 'sk';
  if (language === 'hu') {
    const base = 'Köszönjük. A kérelmét rögzítettük. A rendelő feldolgozza, és ezt követően tájékoztatni fogja. Konkrét időpontot most nem foglaltunk.';
    if (session.requestType === 'new_to_clinic_seen_neurologist') return `${base} A vizsgálatra hozza magával a korábbi neurológiai leleteit és a neurológus által kért vizsgálatok legutóbbi eredményeit. Viszontlátásra.`;
    if (session.requestType === 'prescription' && session.prescriptionEligible) return 'Köszönjük. A receptkérelmét rögzítettük. Az ilyen kérelmeket a rendelő általában még aznap délután dolgozza fel, majd tájékoztatni fogja. Viszontlátásra.';
    if (session.requestType === 'prescription' && !session.prescriptionEligible) return 'A rendelő ezen a módon csak azoknak írhat fel receptet, akiket már megvizsgáltak ebben a jelenlegi rendelőben. A kapcsolatfelvételét feljegyeztük a személyzet számára; ez nem jelenti a recept automatikus felírását. Viszontlátásra.';
    if (session.requestType === 'medical_report') return `${base} A leletért személyesen kell bejönni, és a hosszabbítást a rendelő általában a következő délutánra készíti el.${isSocialPurposeReport(session.detail || '') ? ' A szociális vagy szakértői célú lelet díjköteles a megyei portálon elérhető árjegyzék szerint.' : ''} Viszontlátásra.`;
    if (session.requestType === 'appointment_change_or_cancellation') return `${base} Ha nem tud megjelenni, lehetőleg legalább két nappal korábban értesítse a rendelőt. Viszontlátásra.`;
    return `${base} Viszontlátásra.`;
  }

  const base = 'Ďakujem. Vašu požiadavku sme zaznamenali. Ambulancia ju spracuje a následne vás bude informovať. Konkrétny termín sme teraz nerezervovali.';
  if (session.requestType === 'new_to_clinic_seen_neurologist') return `${base} Na vyšetrenie si prineste predchádzajúce neurologické nálezy a posledné výsledky vyšetrení ordinovaných vaším neurológom. Dovidenia.`;
  if (session.requestType === 'prescription' && session.prescriptionEligible) return 'Ďakujem. Požiadavku na recept sme zaznamenali. Ambulancia tieto požiadavky štandardne vybavuje v priebehu poobedia toho istého dňa a následne vás bude informovať. Dovidenia.';
  if (session.requestType === 'prescription' && !session.prescriptionEligible) return 'Ambulancia môže týmto spôsobom vybaviť recept iba pacientom, ktorí už boli vyšetrení v tejto aktuálnej ambulancii. Váš kontakt sme zaznamenali pre personál; nejde o prísľub predpísania receptu. Dovidenia.';
  if (session.requestType === 'medical_report') return `${base} Pre nález je potrebné zastaviť sa osobne a predĺženie nálezu ambulancia štandardne vybavuje do nasledujúceho poobedia.${isSocialPurposeReport(session.detail || '') ? ' Nálezy na sociálne alebo posudkové účely sú spoplatnené podľa cenníka ambulancie dostupného na portáli VÚC.' : ''} Dovidenia.`;
  if (session.requestType === 'appointment_change_or_cancellation') return `${base} Pri nemožnosti dostaviť sa informujte ambulanciu ideálne aspoň dva dni vopred. Dovidenia.`;
  return `${base} Dovidenia.`;
}

function hasMeaningfulRequest(session: VadkertiSession): boolean {
  return session.answers.some((answer) => answer.step === 'intent' && answer.text.trim().length > 0);
}

function dispatchRequest(
  fastify: FastifyInstance,
  session: VadkertiSession,
  onSuccess?: () => void
): boolean {
  if (!session.clinicId || (!session.requestType && !hasMeaningfulRequest(session))) return false;
  const endedAt = session.endedAt || new Date().toISOString();
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000));
  const event: VoicemailRecordedEvent = {
    event: 'voicemail_recorded',
    clinicId: session.clinicId,
    phone: session.phone,
    routingPhoneNumber: vadkertiBotConfig.clinic.routingPhoneNumber,
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
    .catch((error) => {
      failVoiceEvent(eventKey);
      fastify.log.error(error, 'Failed to create Vadkerti PriXi request');
    });
  return true;
}

function completeCall(fastify: FastifyInstance, reply: FastifyReply, session: VadkertiSession): FastifyReply {
  const message = closingMessage(session);
  session.outcome = 'completed';
  session.endedAt = new Date().toISOString();
  dispatchRequest(fastify, session);
  vadkertiSessionService.delete(session.callSid);
  return renderSimpleEnd(reply, session.language || 'sk', message);
}

function expired(reply: FastifyReply): FastifyReply {
  return renderSimpleEnd(reply, 'sk', text.sk.expired);
}

/**
 * Starts the clinic-specific flow after the shared production router has
 * identified MUDr. Vadkerti's number. This is deliberately a handler rather
 * than a public route: every production call still enters through
 * POST /voice/incoming.
 */
export function startVadkertiVoiceBot(
  reply: FastifyReply,
  body: Record<string, string>
): FastifyReply {
  const session = vadkertiSessionService.create(body.CallSid, body.From || '');
  return renderLanguagePrompt(reply, session);
}

/**
 * Finalizes a useful but unfinished call from the shared terminal-status
 * webhook. Calls that contain only a language choice are intentionally
 * discarded, so the clinic does not receive empty requests.
 */
export function finalizeAbandonedVadkertiCall(
  fastify: FastifyInstance,
  callSid: string,
  endedAt: string = new Date().toISOString()
): boolean {
  const session = vadkertiSessionService.get(callSid);
  if (!session) return false;

  if (!session.clinicId || !hasMeaningfulRequest(session)) {
    vadkertiSessionService.delete(callSid);
    return false;
  }

  session.outcome = 'abandoned';
  session.endedAt = endedAt;
  vadkertiSessionService.save(session);
  return dispatchRequest(fastify, session, () => vadkertiSessionService.delete(callSid));
}

export async function vadkertiVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/vadkerti/prompt', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = vadkertiSessionService.get(body.CallSid);
    if (!session) return expired(reply);
    session.attempts += 1;
    if (session.attempts >= 3) {
      finalizeAbandonedVadkertiCall(fastify, session.callSid);
      return renderSimpleEnd(reply, session.language || 'sk', text[session.language || 'sk'].expired);
    }
    return renderPrompt(reply, session, text[session.language || 'sk'].retry + ' ');
  });

  fastify.post('/vadkerti/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = vadkertiSessionService.get(body.CallSid);
    if (!session) return expired(reply);
    const answer = answerFrom(request);
    if (!answer) return renderPrompt(reply, session, text[session.language || 'sk'].retry + ' ');
    if (session.step !== 'birth_year') session.attempts = 0;
    session.answers.push({ step: session.step, text: answer });

    if (session.step === 'language') {
      const language = parseVadkertiLanguage(answer);
      if (!language) return renderLanguagePrompt(reply, session);
      session.language = language;
      if (!isVadkertiWithinBusinessHours()) {
        vadkertiSessionService.delete(session.callSid);
        return renderSimpleEnd(reply, language, text[language].afterHours);
      }
      try {
        session.clinicId = await resolveClinicId();
      } catch (error) {
        fastify.log.error(error, 'Vadkerti clinic routing validation failed');
        vadkertiSessionService.delete(session.callSid);
        return renderSimpleEnd(reply, language, text[language].technical);
      }
      session.step = 'intent';
      return renderPrompt(reply, session);
    }

    const language = session.language || 'sk';
    if (isVadkertiUrgent(answer)) {
      vadkertiSessionService.delete(session.callSid);
      return renderSimpleEnd(reply, language, text[language].urgent);
    }

    if (session.step === 'intent') {
      moveAfterIntent(session, answer);
      return renderPrompt(reply, session);
    }

    if (session.step === 'current_clinic') {
      const yes = parseVadkertiYesNo(answer);
      if (yes === undefined) return renderPrompt(reply, session, text[language].retry + ' ');
      session.currentClinicPatient = yes;
      if (session.requestType === 'prescription') {
        session.prescriptionEligible = yes;
        session.step = 'detail';
      } else if (yes) {
        session.requestType = 'existing_patient_follow_up';
        session.step = 'name';
      } else {
        session.step = 'prior_neurologist';
      }
      return renderPrompt(reply, session);
    }

    if (session.step === 'prior_neurologist') {
      const yes = parseVadkertiYesNo(answer);
      if (yes === undefined) return renderPrompt(reply, session, text[language].retry + ' ');
      session.requestType = yes ? 'new_to_clinic_seen_neurologist' : 'new_patient_no_neurologist';
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'detail') {
      session.detail = answer;
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'appointment_action') {
      const action = parseAppointmentAction(answer);
      if (!action) return renderPrompt(reply, session, text[language].retry + ' ');
      session.appointmentAction = action;
      session.step = 'appointment_datetime';
      return renderPrompt(reply, session);
    }

    if (session.step === 'appointment_datetime') {
      session.originalAppointment = answer;
      session.step = 'name';
      return renderPrompt(reply, session);
    }

    if (session.step === 'name') {
      session.patientName = answer;
      session.step = 'birth_year';
      return renderPrompt(reply, session);
    }

    if (session.step === 'birth_year') {
      const year = extractBirthYear(answer);
      if (!year && session.attempts < 1) {
        session.attempts += 1;
        return renderPrompt(reply, session, text[language].retry + ' ');
      }
      session.birthYear = year || answer;
      return completeCall(fastify, reply, session);
    }

    return renderPrompt(reply, session, text[language].retry + ' ');
  });
}
