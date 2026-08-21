import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { prixiService } from '../services/prixi.service';
import { sttService } from '../services/stt.service';
import { ivrService } from '../services/ivr.service';
import { CallForwardedEvent, VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, failVoiceEvent, createVoiceEventKey } from '../utils/voice-event-ledger';
import { bookingSessionService, BookingSession } from '../services/booking-session.service';
import { bookioService } from '../services/bookio.service';
import { parseDatePreference, parseEmail, parseName, parseService, parseSlotChoice, parseYesNo } from '../services/booking-nlu.service';

const VoiceResponse = twilio.twiml.VoiceResponse;

export async function voiceRoutes(fastify: FastifyInstance) {

  const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' };
  const vopUrl = 'services.bookio.com/ocna-ambulancia-mudr-veronika-bobocka-bov-clinic/vop/sk';

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
        return ask(reply, session, `${prefix}Aké vyšetrenie potrebujete? Povedzte: vstupné vyšetrenie, kontrola, akútne vyšetrenie, vodičský preukaz alebo estetická medicína.`, 'vstupné vyšetrenie, kontrola, akútne vyšetrenie, vodičský preukaz, estetická medicína');
      case 'date_preference':
        return ask(reply, session, `${prefix}Mám vám nájsť najbližší termín, alebo preferujete dopoludnie či popoludnie?`, 'najbližší termín, dopoludnie, popoludnie');
      case 'slot': {
        const slots = session.offeredSlots || [];
        const choices = slots.map((slot, index) => `možnosť ${index + 1}: ${formatSlot(slot)}`).join('. ');
        return ask(reply, session, `${prefix}Mám tieto termíny. ${choices}. Povedzte číslo možnosti, alebo deň.`, 'prvá možnosť, druhá možnosť, tretia možnosť');
      }
      case 'name': return ask(reply, session, `${prefix}Prosím, povedzte vaše meno a priezvisko.`);
      case 'email': return ask(reply, session, `${prefix}Prosím, nadiktujte vašu e-mailovú adresu. Povedzte napríklad meno, zavináč, domena, bodka sk.`);
      case 'terms': return ask(reply, session, `${prefix}Pred dokončením objednávky potrebujeme váš súhlas so všeobecnými obchodnými podmienkami, ktoré nájdete na ${vopUrl}. Súhlasíte? Povedzte áno alebo nie.`, 'áno, nie');
      case 'marketing': return ask(reply, session, 'Chcete dobrovoľne dostávať marketingové informácie od BOV Clinic? Nie je to podmienka objednania. Povedzte áno alebo nie.', 'áno, nie');
      case 'confirmation': return ask(reply, session, `${prefix}Potvrdzujem: ${session.selectedSlot?.serviceName}, ${session.selectedSlot ? formatSlot(session.selectedSlot) : ''}, na meno ${session.firstName} ${session.lastName}. Môžem termín záväzne objednať?`, 'áno, nie');
    }
  }

  fastify.post('/booking/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const session = bookingSessionService.create(body.CallSid, body.From);
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
      if (service) { session.service = service; session.step = 'date_preference'; understood = true; }
    } else if (session.step === 'date_preference') {
      const preference = parseDatePreference(answer);
      if (preference && session.service) {
        session.preference = preference;
        session.offeredSlots = await bookioService.getAvailableSlots(session.service, preference);
        session.step = 'slot'; understood = true;
      }
    } else if (session.step === 'slot') {
      const choice = parseSlotChoice(answer, session.offeredSlots?.length || 0);
      if (choice !== undefined && session.offeredSlots?.[choice]) { session.selectedSlot = session.offeredSlots[choice]; session.step = 'name'; understood = true; }
    } else if (session.step === 'name') {
      const name = parseName(answer);
      if (name) { Object.assign(session, name); session.step = 'email'; understood = true; }
    } else if (session.step === 'email') {
      const email = parseEmail(answer);
      if (email) { session.email = email; session.step = 'terms'; understood = true; }
    } else if (session.step === 'terms') {
      const yes = parseYesNo(answer);
      if (yes === true) { session.acceptedTerms = true; session.step = 'marketing'; understood = true; }
      if (yes === false) { const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Bez súhlasu s podmienkami objednávku nevieme vytvoriť. Ďakujeme a dovidenia.'); twiml.hangup(); bookingSessionService.delete(session.callSid); return reply.type('text/xml').send(twiml.toString()); }
    } else if (session.step === 'marketing') {
      const yes = parseYesNo(answer);
      if (yes !== undefined) { session.marketingConsent = yes; session.step = 'confirmation'; understood = true; }
    } else if (session.step === 'confirmation') {
      const yes = parseYesNo(answer);
      if (yes === false) return bookingPrompt(reply, session, 'Rozumiem, objednávku nevytvorím. ');
      if (yes === true && session.service && session.selectedSlot && session.firstName && session.lastName && session.email && session.acceptedTerms) {
        try {
          await bookioService.createBooking({ service: session.service, slotId: session.selectedSlot.id, firstName: session.firstName, lastName: session.lastName, email: session.email, phone: session.phone, note: 'Rezervácia vytvorená telefonickou asistentkou.', acceptedTerms: true, marketingConsent: Boolean(session.marketingConsent) });
          const twiml = new VoiceResponse(); twiml.say(sayOptions, `Termín ${formatSlot(session.selectedSlot)} je objednaný. Ďakujeme a dovidenia.`); twiml.hangup(); bookingSessionService.delete(session.callSid);
          return reply.type('text/xml').send(twiml.toString());
        } catch (error) {
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

  fastify.post('/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const fromNumber = body.From;
    let forwardedFrom = body.ForwardedFrom;

    // --- KLOSTERMANN DEMO ---
    if (body.To === '+421800232793') {
      fastify.log.info({ from: fromNumber }, 'Triggering Klostermann demo');
      const twiml = new VoiceResponse();
      const sayGreeting = twiml.say(
        { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
        'Dobrý deň, dovolali ste sa na zubnú kliniku '
      );
      sayGreeting.phoneme({ alphabet: 'ipa', ph: 'ˈklostɛrman' }, 'Klostermann');
      
      twiml.say(
        { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
        '. Linka je momentálne obsadená. Aby ste nemuseli čakať, práve vám posielame SMS správu s odkazom na objednanie. Ďakujeme.'
      );
      
      try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        client.messages.create({
          body: 'Dobrý deň, pre objednanie do ambulancie použite tento odkaz: klostermann.sk/rezervacia',
          // 0800 number is not SMS-capable in Slovakia. 
          // You must use an SMS-capable Twilio number you own, or an Alphanumeric Sender ID (if enabled).
          from: process.env.TWILIO_SMS_FROM_NUMBER || 'PriXi', 
          to: fromNumber
        }).catch(err => fastify.log.error(err, 'Failed to send SMS for Klostermann demo'));
      } catch (err) {
        fastify.log.error(err, 'Error initializing Twilio client for SMS');
      }

      twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    // ------------------------

    if (!forwardedFrom) {
      if (body.To === '+421800232793' || body.To === '0322289055' || body.To === '+421322289055' || body.To === 'sip:0322289055@sip.twilio.com') {
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

      if (!ivrService.shouldAllowCall(config, forwardedFrom)) {
        twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Toto číslo je momentálne nedostupné.');
        twiml.reject();
        return reply.type('text/xml').send(twiml.toString());
      }

      if (config.bookingEnabled || process.env.BOOKING_ENABLED === 'true') {
        twiml.redirect('/voice/booking/start');
        return reply.type('text/xml').send(twiml.toString());
      }

      const greeting = config.greetingMessage || 'Dobrý deň, dovolali ste sa do ambulancie. Pre zanechanie odkazu popíšte po zaznení tónu najprv váš problém a po skončení stlačte hociktoré tlačidlo.';

      twiml.say(
        { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
        greeting
      );
      twiml.record({
        action: `/voice/record-problem?forwardedFrom=${encodeURIComponent(forwardedFrom)}`,
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

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Ďakujem. Teraz prosím uveďte vaše meno a priezvisko, a po skončení stlačte hociktoré tlačidlo.');
    twiml.record({
      action: `/voice/record-name?problemUrl=${encodeURIComponent(problemUrl || '')}&problemDuration=${problemDuration}&forwardedFrom=${encodeURIComponent(forwardedFrom)}`,
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

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Rozumiem. Na záver prosím uveďte váš rok narodenia a stlačte hociktoré tlačidlo.');
    twiml.record({
      action: `/voice/recording-complete?problemUrl=${encodeURIComponent(problemUrl)}&problemDuration=${problemDuration}&nameUrl=${encodeURIComponent(nameUrl || '')}&nameDuration=${nameDuration}&forwardedFrom=${encodeURIComponent(forwardedFrom)}`,
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
    eventKey: string
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
          transcribeSafe(nameUrl, 'Meno a priezvisko pacienta, napríklad Ján Kováč, Mária Nováková.'),
          transcribeSafe(birthYearUrl, 'Rok narodenia pacienta vo formáte 4-miestneho čísla, napríklad 1985, 1990, 2003, 1952. Nevymýšľaj si webové stránky ani vety, uveď len číslo.'),
          transcribeSafe(problemUrl, 'Popis zdravotného problému pacienta pre lekára. Napríklad bolesť chrbta, recept na lieky, kašeľ, teplota. Alebo sa len jednoducho chce objednať na termín, alebo sa zaujíma o výsledky z vyšetrenia, a pod.')
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
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Rozumiem, vaša požiadavka je zaznamenaná, ambulancia sa vám po jej prijatí ozve. Ďakujeme a dovidenia.');
    twiml.hangup();

    // Return XML to Twilio immediately to prevent timeouts
    reply.type('text/xml').send(twiml.toString());

    if (problemUrl || nameUrl || birthYearUrl) {
      const eventKey = createVoiceEventKey('voicemail_recorded', providerCallId);
      // Run heavy processing asynchronously in background
      handleVoicemailBackground(fromNumber, forwardedFrom, nameUrl, birthYearUrl, problemUrl, durationSeconds, callStartedAt, callEndedAt, providerCallId, eventKey)
        .catch(err => fastify.log.error(err, 'Background voicemail task failed'));
    }
  });
}
