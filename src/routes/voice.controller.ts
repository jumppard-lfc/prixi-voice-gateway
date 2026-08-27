import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { prixiService } from '../services/prixi.service';
import { sttService } from '../services/stt.service';
import { ivrService } from '../services/ivr.service';
import { bulkGateSmsService } from '../services/bulkgate-sms.service';
import { CallForwardedEvent, VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, failVoiceEvent, createVoiceEventKey } from '../utils/voice-event-ledger';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const VoiceResponse = twilio.twiml.VoiceResponse;

const CELKOVA_PHONE_NUMBER = '+420910927082';
const BENOVA_BALOGHOVA_PHONE_NUMBER = '+420910927739';
const KLOSTERMANN_PHONE_NUMBER = '+420910924239';
const KLOSTERMANN_SK_GREETING = 'Dobrý deň, dovolali ste sa do Ortodoncia Klostermann. Aby ste nemuseli čakať, posielame Vám SMS správu s odkazom na objednanie. Ďakujeme.';
const KLOSTERMANN_EN_GREETING = 'Hello, you have reached Klostermann Orthodontics. So that you don’t have to wait, we will send you an SMS with a link to order. Thank you.';
const KLOSTERMANN_SMS = 'Dobrý deň, pre objednanie do ambulancie kliknite na odkaz klostermann.sk/rezervacia.\n\nHello, to make an appointment for the clinic, click on the link klostermann.sk/rezervacia';
const KLOSTERMANN_GREETING_MEDIA_PATH = '/media/klostermann-greeting-v1.wav';
const KLOSTERMANN_GREETING_FILE = resolve(__dirname, '../assets/audio/klostermann-greeting-v1.wav');
const DEFAULT_GREETING = 'Dobrý deň, dovolali ste sa do ambulancie. Pre zanechanie odkazu popíšte po zaznení tónu najprv váš problém a po skončení stlačte hociktoré tlačidlo.';
const PEDIATRIC_GREETING = 'Dobrý deň, dovolali ste sa do pediatrickej ambulancie doktorky Čelkovej. Ak ide o náhly život ohrozujúci stav, volajte tiesňovú linku 155 alebo 112. V opačnom prípade nám prosím po zaznení tónu stručne povedzte, s čím sa na ambulanciu obraciate. Môže ísť napríklad o zdravotné ťažkosti dieťaťa, predpis liekov, výsledky vyšetrenia alebo objednanie. Po skončení stlačte ľubovoľné tlačidlo.';
const ORTHOPEDIC_GREETING = 'Dobrý deň, dovolali ste sa do ortopedickej ambulancie pani doktorky Miroslavy Beňovej Baloghovej. Po zaznení tónu nám, prosím, povedzte, s čím vám môžeme pomôcť. Po skončení stlačte ľubovoľné tlačidlo.';

export async function voiceRoutes(fastify: FastifyInstance) {

  fastify.post('/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const fromNumber = body.From;
    let forwardedFrom = body.ForwardedFrom;

    // Klostermann's carrier forwards an unanswered call from the clinic mobile
    // to this dedicated bot number after approximately 15 seconds.
    const isKlostermannCall = body.ForwardedFrom === KLOSTERMANN_PHONE_NUMBER
      || body.To === KLOSTERMANN_PHONE_NUMBER;

    if (isKlostermannCall) {
      fastify.log.info({ from: fromNumber, to: body.To, forwardedFrom: body.ForwardedFrom }, 'Handling unanswered Klostermann call');
      const twiml = new VoiceResponse();
      if (existsSync(KLOSTERMANN_GREETING_FILE)) {
        const forwardedProto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
        const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${forwardedProto}://${forwardedHost}`).replace(/\/$/, '');
        twiml.play(`${publicBaseUrl}${KLOSTERMANN_GREETING_MEDIA_PATH}`);
      } else {
        fastify.log.error({ path: KLOSTERMANN_GREETING_FILE }, 'Klostermann greeting file is missing; using TTS fallback');
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' as any },
          KLOSTERMANN_SK_GREETING
        );
        twiml.say(
          { language: 'en-GB', voice: 'Google.en-GB-Wavenet-A' as any },
          KLOSTERMANN_EN_GREETING
        );
      }

      if (process.env.NODE_ENV !== 'test') {
        bulkGateSmsService.sendTransactionalSms(fromNumber, KLOSTERMANN_SMS).then(result => {
          fastify.log.info({ messageId: result.messageId, status: result.status, to: fromNumber }, 'Klostermann booking SMS accepted by BulkGate');
        }).catch(err => {
          const error = err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
          fastify.log.error({ err: error, to: fromNumber }, 'Failed to send Klostermann booking SMS through BulkGate');
        });
      }

      twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    if (!forwardedFrom) {
      if (body.To === CELKOVA_PHONE_NUMBER) {
        forwardedFrom = CELKOVA_PHONE_NUMBER;
        fastify.log.info({ from: fromNumber, to: body.To }, 'Applied direct Twilio number routing for MUDr. Celkova');
      } else if (body.To === BENOVA_BALOGHOVA_PHONE_NUMBER) {
        forwardedFrom = BENOVA_BALOGHOVA_PHONE_NUMBER;
        fastify.log.info({ from: fromNumber, to: body.To }, 'Applied direct Twilio number routing for MUDr. Benova Baloghova');
      } else if (body.To === '+421800232793' || body.To === '0322289055' || body.To === '+421322289055' || body.To === 'sip:0322289055@sip.twilio.com') {
        forwardedFrom = '+421911500609'; // Hardcoded fallback for MUDr. Dobrovodska
        fastify.log.info({ from: fromNumber, to: body.To }, 'Applied hardcoded ForwardedFrom fallback for Dobrovodska');
      } else {
        fastify.log.error({ from: fromNumber, to: body.To }, '[CRITICAL ALERT] Missing ForwardedFrom header! The SIP Diversion header was dropped by the carrier. Routing cannot reliably identify the clinic.');
        forwardedFrom = '';
      }
    }

    fastify.log.info({ from: fromNumber, forwardedFrom }, 'Incoming voice call received');

    const twiml = new VoiceResponse();

    try {
      const config = await prixiService.getConfig(forwardedFrom || fromNumber);

      const isCelkovaNumber = forwardedFrom === CELKOVA_PHONE_NUMBER;
      const isBenovaBaloghovaNumber = forwardedFrom === BENOVA_BALOGHOVA_PHONE_NUMBER;
      const isDedicatedVoiceBotNumber = isCelkovaNumber || isBenovaBaloghovaNumber;

      if (!isDedicatedVoiceBotNumber && !ivrService.shouldAllowCall(config, forwardedFrom)) {
        twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Toto číslo je momentálne nedostupné.');
        twiml.reject();
        return reply.type('text/xml').send(twiml.toString());
      }

      const pediatricMode = isCelkovaNumber || (!isBenovaBaloghovaNumber && config.pediatricMode === true);
      const greeting = config.greetingMessage
        || (isBenovaBaloghovaNumber ? ORTHOPEDIC_GREETING : pediatricMode ? PEDIATRIC_GREETING : DEFAULT_GREETING);

      twiml.say(
        { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
        greeting
      );
      twiml.record({
        action: `/voice/record-problem?forwardedFrom=${encodeURIComponent(forwardedFrom)}&pediatricMode=${pediatricMode}`,
        playBeep: true,
        maxLength: 120,
        timeout: 10
      });

      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /incoming');
      twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Momentálne máme technické problémy.');
      twiml.reject();
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/record-problem', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;
    const problemUrl = body.RecordingUrl;
    const problemDuration = body.RecordingDuration || '0';
    const forwardedFrom = query.forwardedFrom || '';
    const pediatricMode = query.pediatricMode === 'true';

    const twiml = new VoiceResponse();
    const namePrompt = pediatricMode
      ? 'Ďakujem. Teraz, prosím, uveďte meno a priezvisko dieťaťa, ktorého sa požiadavka týka. Po skončení stlačte ľubovoľné tlačidlo.'
      : 'Ďakujem. Teraz prosím uveďte vaše meno a priezvisko, a po skončení stlačte hociktoré tlačidlo.';
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, namePrompt);
    twiml.record({
      action: `/voice/record-name?problemUrl=${encodeURIComponent(problemUrl || '')}&problemDuration=${problemDuration}&forwardedFrom=${encodeURIComponent(forwardedFrom)}&pediatricMode=${pediatricMode}`,
      playBeep: true,
      maxLength: 20,
      timeout: 5
    });

    return reply.type('text/xml').send(twiml.toString());
  });

  fastify.post('/record-name', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;
    const nameUrl = body.RecordingUrl;
    const nameDuration = body.RecordingDuration || '0';
    const problemUrl = query.problemUrl || '';
    const problemDuration = query.problemDuration || '0';
    const forwardedFrom = query.forwardedFrom || '';
    const pediatricMode = query.pediatricMode === 'true';

    const twiml = new VoiceResponse();
    const birthYearPrompt = pediatricMode
      ? 'Na záver, prosím, uveďte rok narodenia dieťaťa a stlačte ľubovoľné tlačidlo.'
      : 'Rozumiem. Na záver prosím uveďte váš rok narodenia a stlačte hociktoré tlačidlo.';
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, birthYearPrompt);
    twiml.record({
      action: `/voice/recording-complete?problemUrl=${encodeURIComponent(problemUrl)}&problemDuration=${problemDuration}&nameUrl=${encodeURIComponent(nameUrl || '')}&nameDuration=${nameDuration}&forwardedFrom=${encodeURIComponent(forwardedFrom)}&pediatricMode=${pediatricMode}`,
      playBeep: true,
      maxLength: 10,
      timeout: 5
    });

    return reply.type('text/xml').send(twiml.toString());
  });

  async function handleVoicemailBackground(
    fromNumber: string,
    forwardedFrom: string,
    nameUrl: string,
    birthYearUrl: string,
    problemUrl: string,
    durationSeconds: number,
    callStartedAt: string,
    callEndedAt: string,
    providerCallId: string,
    eventKey: string,
    pediatricMode: boolean
  ) {
    if (!claimVoiceEvent(eventKey)) {
      fastify.log.info({ providerCallId }, 'Duplicate voicemail webhook ignored in background');
      return;
    }

    try {
      const config = await prixiService.getConfig(forwardedFrom || fromNumber);

      try {
        const transcribeSafe = async (url: string, prompt: string) => {
          if (!url) return '';
          // Ensure URL ends with .mp3 to get the compressed format and avoid Twilio issues
          const finalUrl = url.includes('.mp3') || url.includes('.wav') ? url : `${url}.mp3`;
          try {
            return await sttService.transcribeAudioUrl(finalUrl, prompt);
          } catch (err) {
            fastify.log.error(err, `Transcription failed for URL: ${finalUrl}`);
            return ''; // Return empty string so other transcripts are not lost
          }
        };

        const [nameTranscript, birthYearTranscript, problemTranscript] = await Promise.all([
          transcribeSafe(nameUrl, pediatricMode
            ? 'Meno a priezvisko dieťaťa, ktoré rodič uvádza ako pacienta pediatrickej ambulancie. Napríklad Adam Kováč, Ema Nováková.'
            : 'Meno a priezvisko pacienta, napríklad Ján Kováč, Mária Nováková.'),
          transcribeSafe(birthYearUrl, pediatricMode
            ? 'Rok narodenia dieťaťa vo formáte 4-miestneho čísla, napríklad 2018, 2021, 2024. Nevymýšľaj si webové stránky ani vety, uveď len číslo.'
            : 'Rok narodenia pacienta vo formáte 4-miestneho čísla, napríklad 1985, 1990, 2003, 1952. Nevymýšľaj si webové stránky ani vety, uveď len číslo.'),
          transcribeSafe(problemUrl, pediatricMode
            ? 'Požiadavka rodiča pre pediatrickú ambulanciu týkajúca sa dieťaťa. Môže ísť o zdravotné ťažkosti, kašeľ, teplotu, predpis liekov, výsledky vyšetrenia alebo objednanie.'
            : 'Popis zdravotného problému pacienta pre lekára. Napríklad bolesť chrbta, recept na lieky, kašeľ, teplota. Alebo sa len jednoducho chce objednať na termín, alebo sa zaujíma o výsledky z vyšetrenia, a pod.')
        ]);

        const event: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          nameUrl,
          birthYearUrl,
          problemUrl,
          nameTranscript,
          birthYearTranscript,
          problemTranscript
        };

        await prixiService.sendEvent(event, 3, eventKey);
        completeVoiceEvent(eventKey);
      } catch (err) {
        fastify.log.error(err, 'STT processing failed, sending event without transcript');
        const fallbackEvent: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          nameUrl,
          birthYearUrl,
          problemUrl,
          nameTranscript: '',
          birthYearTranscript: '',
          problemTranscript: ''
        };

        try {
          await prixiService.sendEvent(fallbackEvent, 3, eventKey);
          completeVoiceEvent(eventKey);
        } catch (reportErr) {
          failVoiceEvent(eventKey);
          fastify.log.error(reportErr, 'Failed to report fallback voicemail event');
        }
      }

    } catch (err) {
      failVoiceEvent(eventKey);
      fastify.log.error(err, 'Failed to process recording complete');
    }
  }

  fastify.post('/recording-complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;

    const birthYearUrl = body.RecordingUrl;
    const nameUrl = query.nameUrl || '';
    const problemUrl = query.problemUrl || '';
    const forwardedFrom = query.forwardedFrom || '';
    const pediatricMode = query.pediatricMode === 'true';

    const fromNumber = body.From;
    const providerCallId = body.CallSid;

    const nameDuration = parseInt(query.nameDuration || '0', 10);
    const problemDuration = parseInt(query.problemDuration || '0', 10);
    const birthYearDuration = parseInt(body.RecordingDuration || '0', 10);
    const durationSeconds = nameDuration + birthYearDuration + problemDuration;

    // Rough estimation if exact start/end differ
    const callStartedAt = new Date(Date.now() - durationSeconds * 1000).toISOString();
    const callEndedAt = new Date().toISOString();

    fastify.log.info({ from: fromNumber, durationSeconds, problemUrl }, 'Voicemail recording complete');

    const twiml = new VoiceResponse();
    const completionMessage = pediatricMode
      ? 'Ďakujeme, vašu požiadavku sme zaznamenali. Ambulancia sa vám po jej spracovaní ozve na telefónne číslo, z ktorého voláte. Dovidenia.'
      : 'Rozumiem, vaša požiadavka je zaznamenaná, ambulancia sa vám po jej prijatí ozve. Ďakujeme a dovidenia.';
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, completionMessage);
    twiml.hangup();

    // Return XML to Twilio immediately to prevent timeouts
    reply.type('text/xml').send(twiml.toString());

    if (problemUrl || nameUrl || birthYearUrl) {
      const eventKey = createVoiceEventKey('voicemail_recorded', providerCallId);
      // Run heavy processing asynchronously in background
      handleVoicemailBackground(fromNumber, forwardedFrom, nameUrl, birthYearUrl, problemUrl, durationSeconds, callStartedAt, callEndedAt, providerCallId, eventKey, pediatricMode)
        .catch(err => fastify.log.error(err, 'Background voicemail task failed'));
    }
  });
}
