const twilio = require('twilio');
const appModule = require('./src/app');

async function run() {
  const app = appModule.default;
  await app.ready();

  const endpoint = '/voice/incoming';
  const params = {
    From: '+421900000001',
    CallSid: 'CA88888888888888888888888888888888',
  };

  const signature = twilio.getExpectedTwilioSignature('test-auth-token', `https://127.0.0.1:3000${endpoint}`, params);

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'host': '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': signature,
    },
    payload: 'From=%2B421900000001&CallSid=CA88888888888888888888888888888888',
  });

  console.log('\n--- VÝSLEDNÁ ODPOVEĎ PRE TWILIO (XML) ---');
  console.log(response.body);
  console.log('-----------------------------------------\n');
  
  await app.close();
}

process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
run().catch(console.error);
