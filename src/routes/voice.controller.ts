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
import { bookingSessionService, BookingSession } from '../services/booking-session.service';
import { bookingAuditService } from '../services/booking-audit.service';
import { bookioService } from '../services/bookio.service';
import { parseDatePreference, parseName, parseService, parseSlotChoice, parseYesNo } from '../services/booking-nlu.service';

const VoiceResponse = twilio.twiml.VoiceResponse;

const CELKOVA_PHONE_NUMBER = '+420910927082';
const BENOVA_BALOGHOVA_PHONE_NUMBER = '+420910927739';
const KLOSTERMANN_PHONE_NUMBER = '+420910924239';
const KLOSTERMANN_SK_GREETING = 'Dobrý deň, dovolali ste sa do Ortodoncia Klostermann. Aby ste nemuseli čakať, posielame Vám SMS správu s odkazom na objednanie. Ďakujeme.';
const KLOSTERMANN_EN_GREETING = 'Hello, you have reached Klostermann Orthodontics. So that you don’t have to wait, we will send you an SMS with a link to order. Thank you.';
const KLOSTERMANN_SMS = 'Dobrý deň, pre objednanie do ambulancie kliknite na odkaz klostermann.sk/rezervacia.\n\nHello, to make an appointment for the clinic, click on the link klostermann.sk/rezervacia';
const KLOSTERMANN_GREETING_MEDIA_PATH = '/media/klostermann-greeting-v5.wav';
const KLOSTERMANN_GREETING_FILE = resolve(__dirname, '../assets/audio/klostermann-greeting-v5.wav');
const DEFAULT_GREETING = 'Dobrý deň, dovolali ste sa do ambulancie. Pre zanechanie odkazu popíšte po zaznení tónu najprv váš problém a po skončení stlačte hociktoré tlačidlo.';
const PEDIATRIC_GREETING = 'Dobrý deň, dovolali ste sa do pediatrickej ambulancie doktorky Čelkovej. Ak ide o náhly život ohrozujúci stav, volajte tiesňovú linku 155 alebo 112. V opačnom prípade nám prosím po zaznení tónu stručne povedzte, s čím sa na ambulanciu obraciate. Môže ísť napríklad o zdravotné ťažkosti dieťaťa, predpis liekov, výsledky vyšetrenia alebo objednanie. Po skončení stlačte ľubovoľné tlačidlo.';
const ORTHOPEDIC_GREETING = 'Dobrý deň, dovolali ste sa do ortopedickej ambulancie pani doktorky Miroslavy Beňovej Baloghovej. Po zaznení tónu nám, prosím, povedzte, s čím vám môžeme pomôcť. Po skončení stlačte ľubovoľné tlačidlo.';

export async function voiceRoutes(fastify: FastifyInstance) {

  const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' };

  function formatSlot(slot: { startAt: string }): string {
    return new Intl.DateTimeFormat('sk-SK', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bratislava' }).format(new Date(slot.startAt));
  }

  function ask(reply: FastifyReply, session: BookingSession, message: string, hints = ''): FastifyReply {
    bookingSessionService.save(session);
    const twiml = new VoiceResponse();
    const gather = twiml.gather({ input: ['speech', 'dtmf'], action: '/voice/booking/answer', method: 'POST', timeout: 5, speechTimeout: 'auto', language: 'sk-SK', hints } as any);
    gather.say(sayOptions, message);
    twiml.say(sayOptions, 'Odpoveď som nezachytila. Skúsme to, prosím, znova.');
    twiml.redirect('/voice/booking/retry');
    return reply.type('text/xml').send(twiml.toString());
  }

  function bookingPrompt(reply: FastifyReply, session: BookingSession, prefix = ''): FastifyReply {
    switch (session.step) {
      case 'service':
        return ask(reply, session, `${prefix}Pre vstupné vyšetrenie stlačte 1 alebo povedzte vstupné vyšetrenie. Pre kontrolu stlačte 2. Pre akútne vyšetrenie stlačte 3. Pre vyšetrenie na vodičský preukaz stlačte 4. Pre estetickú medicínu stlačte 5.`, 'vstupné vyšetrenie, kontrola, akútne vyšetrenie, vodičský preukaz, estetická medicína');
      case 'date_preference':
        return ask(reply, session, `${prefix}Pre najbližší termín stlačte 1. Pre dopoludnie stlačte 2. Pre popoludnie stlačte 3. Môžete odpovedať aj hlasom.`, 'najbližší termín, dopoludnie, popoludnie');
      case 'slot': {
        const slots = session.offeredSlots || [];
        const choices = slots.map((slot, index) => `možnosť ${index + 1}: ${formatSlot(slot)}`).join('. ');
        return ask(reply, session, `${prefix}Mám tieto termíny. ${choices}. Povedzte číslo možnosti, alebo deň.`, 'prvá možnosť, druhá možnosť, tretia možnosť');
      }
      case 'name': return ask(reply, session, `${prefix}Prosím, povedzte vaše meno a priezvisko.`);
      case 'terms': return ask(reply, session, `${prefix}Pred dokončením objednávky potrebujeme váš súhlas so všeobecnými obchodnými podmienkami BOV Clinic. Podmienky sú dostupné na webovej stránke ambulancie. Súhlasíte? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`, 'áno, nie');
      case 'marketing': return ask(reply, session, 'Chcete dobrovoľne dostávať marketingové informácie od BOV Clinic? Nie je to podmienka objednania. Povedzte áno alebo nie.', 'áno, nie');
      case 'confirmation': return ask(reply, session, `${prefix}Potvrdzujem: ${session.selectedSlot?.serviceName}, ${session.selectedSlot ? formatSlot(session.selectedSlot) : ''}, na meno ${session.firstName} ${session.lastName}. Môžem termín záväzne objednať?`, 'áno, nie');
    }
  }

  fastify.post('/booking/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const session = bookingSessionService.create(body.CallSid, body.From);
    bookingAuditService.record(session.callSid, 'started', { phone: session.phone });
    return bookingPrompt(reply, session, 'Dobrý deň, som automatická asistentka BOV Clinic. Pomôžem vám s objednaním. ');
  });

  fastify.post('/booking/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = bookingSessionService.get((request.body as Record<string, string>).CallSid);
    if (!session) {
      const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Platnosť objednávky vypršala. Zavolajte nám, prosím, znovu.'); twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    session.attempts += 1;
    if (session.attempts >= 3) {
      const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Odpovedi sa mi nepodarilo porozumieť. Spojím vás s ambulanciou.'); twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    return bookingPrompt(reply, session, 'Prepáčte, nerozumela som. ');
  });

  fastify.post('/booking/answer', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const session = bookingSessionService.get(body.CallSid);
    if (!session) return bookingPrompt(reply, bookingSessionService.create(body.CallSid, body.From), 'Začnime, prosím, od začiatku. ');
    const answer = body.SpeechResult || body.Digits || '';
    let understood = false;

    if (session.step === 'service') {
      const service = parseService(answer);
      if (service) {
        session.service = service; session.step = 'date_preference'; understood = true;
        bookingAuditService.record(session.callSid, 'service_selected', { service });
      }
    } else if (session.step === 'date_preference') {
      const preference = parseDatePreference(answer);
      if (preference && session.service) {
        session.preference = preference;
        session.offeredSlots = await bookioService.getAvailableSlots(session.service, preference);
        session.step = 'slot'; understood = true;
        bookingAuditService.record(session.callSid, 'slots_offered', { service: session.service, count: session.offeredSlots.length });
      }
    } else if (session.step === 'slot') {
      const choice = parseSlotChoice(answer, session.offeredSlots?.length || 0);
      if (choice !== undefined && session.offeredSlots?.[choice]) {
        session.selectedSlot = session.offeredSlots[choice]; session.step = 'name'; understood = true;
        bookingAuditService.record(session.callSid, 'slot_selected', { slotId: session.selectedSlot.id, startAt: session.selectedSlot.startAt });
      }
    } else if (session.step === 'name') {
      const name = parseName(answer);
      if (name) {
        Object.assign(session, name); session.step = 'terms'; understood = true;
        bookingAuditService.record(session.callSid, 'identity_collected', { firstName: name.firstName, lastName: name.lastName });
      }
    } else if (session.step === 'terms') {
      const yes = parseYesNo(answer);
      if (yes === true) {
        session.acceptedTerms = true; session.step = 'marketing'; understood = true;
        bookingAuditService.record(session.callSid, 'terms_accepted');
      }
      if (yes === false) { const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Bez súhlasu s podmienkami objednávku nevieme vytvoriť. Ďakujeme a dovidenia.'); twiml.hangup(); bookingSessionService.delete(session.callSid); return reply.type('text/xml').send(twiml.toString()); }
    } else if (session.step === 'marketing') {
      const yes = parseYesNo(answer);
      if (yes !== undefined) {
        session.marketingConsent = yes; session.step = 'confirmation'; understood = true;
        bookingAuditService.record(session.callSid, 'marketing_recorded', { consent: yes });
      }
    } else if (session.step === 'confirmation') {
      const yes = parseYesNo(answer);
      if (yes === false) return bookingPrompt(reply, session, 'Rozumiem, objednávku nevytvorím. ');
      if (yes === true && session.service && session.selectedSlot && session.firstName && session.lastName && session.acceptedTerms) {
        try {
          const booking = await bookioService.createBooking({ service: session.service, slotId: session.selectedSlot.id, firstName: session.firstName, lastName: session.lastName, phone: session.phone, note: 'Rezervácia vytvorená telefonickou asistentkou.', acceptedTerms: true, marketingConsent: Boolean(session.marketingConsent) });
          bookingAuditService.record(session.callSid, 'booking_created', { bookingId: booking.bookingId, provider: 'bookio' });
          let smsDelivered = false;
          try {
            if (process.env.BOOKING_SMS_MOCK_MODE === 'true' || process.env.NODE_ENV === 'test') {
              smsDelivered = true;
              bookingAuditService.record(session.callSid, 'sms_sent', { mode: 'mock', to: session.phone });
              fastify.log.info({ callSid: session.callSid, to: session.phone }, 'Mock booking confirmation SMS sent');
            } else {
              const sms = await bulkGateSmsService.sendTransactionalSms(session.phone, `BOV Clinic: váš termín ${formatSlot(session.selectedSlot)} je objednaný. Ak potrebujete termín zmeniť, kontaktujte ambulanciu.`, 'booking-confirmation');
              smsDelivered = true;
              bookingAuditService.record(session.callSid, 'sms_sent', { messageId: sms.messageId, status: sms.status, to: session.phone });
            }
          } catch (smsError) {
            bookingAuditService.record(session.callSid, 'sms_failed', { message: smsError instanceof Error ? smsError.message : String(smsError) });
            fastify.log.error(smsError, 'Booking confirmation SMS failed');
          }
          bookingAuditService.record(session.callSid, 'completed', { smsDelivered });
          const twiml = new VoiceResponse();
          twiml.say(sayOptions, smsDelivered ? `Termín ${formatSlot(session.selectedSlot)} je objednaný. Potvrdenie vám posielame SMS správou. Ďakujeme a dovidenia.` : `Termín ${formatSlot(session.selectedSlot)} je objednaný. Potvrdenie SMS správou sa nepodarilo odoslať. Ďakujeme a dovidenia.`);
          twiml.hangup(); bookingSessionService.delete(session.callSid);
          return reply.type('text/xml').send(twiml.toString());
        } catch (error) {
          bookingAuditService.record(session.callSid, 'failed', { message: error instanceof Error ? error.message : String(error) });
          fastify.log.error(error, 'Bookio booking failed');
          const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Termín sa momentálne nepodarilo vytvoriť. Prosím, kontaktujte ambulanciu priamo.'); twiml.hangup();
          return reply.type('text/xml').send(twiml.toString());
        }
      }
    }

    if (!understood) return bookingPrompt(reply, session, 'Prepáčte, nerozumela som. ');
    session.attempts = 0;
    return bookingPrompt(reply, session);
  });

  // Enabled only with an explicit secret. Intended for the local pilot; a real PriXi dashboard
  // will read the same information from the persistent, access-controlled audit store.
  fastify.get('/booking/debug/:callSid', async (request: FastifyRequest, reply: FastifyReply) => {
    const debugToken = process.env.BOOKING_DEBUG_TOKEN;
    const authorization = request.headers.authorization;
    if (!debugToken || authorization !== `Bearer ${debugToken}`) return reply.code(404).send();
    const callSid = (request.params as { callSid: string }).callSid;
    const events = bookingAuditService.get(callSid);
    if (!events) return reply.code(404).send({ message: 'Booking call was not found or has expired.' });
    return { callSid, events };
  });

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

      if (config.bookingEnabled || process.env.BOOKING_ENABLED === 'true') {
        twiml.redirect('/voice/booking/start');
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
