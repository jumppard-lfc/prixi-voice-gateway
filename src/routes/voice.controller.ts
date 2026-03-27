import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { prixiService } from '../services/prixi.service';
import { sttService } from '../services/stt.service';
import { ivrService } from '../services/ivr.service';
import { CallForwardedEvent, VoicemailRecordedEvent } from '../types';

const VoiceResponse = twilio.twiml.VoiceResponse;

export async function voiceRoutes(fastify: FastifyInstance) {
  
  fastify.post('/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const fromNumber = body.From;
    
    const twiml = new VoiceResponse();

    try {
      const config = await prixiService.getConfig(fromNumber);

      if (!ivrService.shouldAllowCall(config)) {
        twiml.say({ language: 'en-US' }, 'This number is currently unavailable.');
        twiml.reject();
        return reply.type('text/xml').send(twiml.toString());
      }

      const isDuringHours = ivrService.isDuringOfficeHours(config);

      if (isDuringHours) {
        const gather = twiml.gather({
          numDigits: 1,
          action: '/voice/gather', 
          timeout: 5
        });
        gather.say(
          { language: 'sk-SK' }, 
          'Dobr\u00fd de\u0148. Ak ide o urgentn\u00fd stav, stla\u010dte 1. V opa\u010dnom pr\u00edpade pop\u00ed\u0161te svoj probl\u00e9m po zaznen\u00ed t\u00f3nu.'
        );
        
        // Timeout/No input -> fallback to voicemail (skipping the gather)
        twiml.record({
          action: '/voice/recording-complete',
          playBeep: true,
          maxLength: 120
        });
      } else {
        twiml.say(
          { language: 'sk-SK' }, 
          'Moment\u00e1lne sa nach\u00e1dzate mimo ordina\u010dn\u00fdch hod\u00edn. Pros\u00edm, zanechajte hlasov\u00fa spr\u00e1vu.'
        );
        twiml.record({
          action: '/voice/recording-complete',
          playBeep: true,
          maxLength: 120
        });
      }

      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /incoming');
      twiml.say({ language: 'en-US' }, 'We are currently experiencing technical difficulties.');
      twiml.reject();
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/gather', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const digits = body.Digits;
    const fromNumber = body.From;
    const callSid = body.CallSid;

    const twiml = new VoiceResponse();
    
    try {
      if (digits === '1') {
        const config = await prixiService.getConfig(fromNumber);
        
        if (config.allowForwardDuringOfficeHours && config.forwardPhoneNumber) {
          twiml.dial(config.forwardPhoneNumber);
          
          const event: CallForwardedEvent = {
            event: 'call_forwarded',
            clinicId: config.clinicId,
            phone: fromNumber,
            forwardedTo: config.forwardPhoneNumber,
            callSid: callSid,
            timestamp: new Date().toISOString()
          };

          // Dispatch event async
          prixiService.sendEvent(event).catch((err: any) => {
             fastify.log.error(err, 'Failed to report call forwarding');
          });

        } else {
          // Fallback to record if forwarding isn't allowed
          twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
        }
      } else {
        // Did not press 1 -> Voicemail
        twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
      }
      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /gather');
      twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/recording-complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const recordingUrl = body.RecordingUrl;
    const fromNumber = body.From;
    const providerCallId = body.CallSid;
    const durationSeconds = parseInt(body.RecordingDuration || '0', 10);
    // Rough estimation if exact start/end differ
    const callStartedAt = new Date(Date.now() - durationSeconds * 1000).toISOString(); 
    const callEndedAt = new Date().toISOString(); 

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK' }, '\u010eakujeme, va\u0161a spr\u00e1va bola zaznamenan\u00e1. Dovidenia.');
    twiml.hangup();
    reply.type('text/xml').send(twiml.toString());

    if (!recordingUrl) return;

    try {
      const config = await prixiService.getConfig(fromNumber);
      
      sttService.transcribeAudioUrl(recordingUrl).then(async transcript => {
        const event: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          audioUrl: recordingUrl,
          transcript
        };
        await prixiService.sendEvent(event);
      }).catch(async err => {
        fastify.log.error(err, 'STT processing failed, sending event without transcript');
        const fallbackEvent: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          audioUrl: recordingUrl,
          transcript: ''
        };
        await prixiService.sendEvent(fallbackEvent).catch(reportErr => {
          fastify.log.error(reportErr, 'Failed to report fallback voicemail event');
        });
      });
      
    } catch (err) {
      fastify.log.error(err, 'Failed to process recording complete');
    }
  });
}
