const twilio = require('twilio');
const twiml = new twilio.twiml.VoiceResponse();
const gather = twiml.gather({ numDigits: 1, action: '/voice/gather', timeout: 5 });
gather.say({ language: 'sk-SK', voice: 'Polly.Viktoria' }, 'Dobry den');
twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
console.log(twiml.toString());
