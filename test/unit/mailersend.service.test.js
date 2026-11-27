const test = require('node:test');
const assert = require('node:assert/strict');

const { MailerSendService } = require('../../src/services/mailersend.service');

const originalEnv = {
  token: process.env.MAILERSEND_API_TOKEN,
  fromEmail: process.env.MAILERSEND_FROM_EMAIL,
  fromName: process.env.MAILERSEND_FROM_NAME,
};

function event(overrides = {}) {
  return {
    event: 'voicemail_recorded',
    clinicId: '152',
    phone: '+421900123456',
    routingPhoneNumber: '+421911135193',
    durationSeconds: 12,
    callStartedAt: '2026-11-18T10:30:00.000Z',
    callEndedAt: '2026-11-18T10:30:12.000Z',
    providerCallId: 'CAtest-mailersend',
    nameUrl: '',
    birthYearUrl: '',
    problemUrl: 'https://api.twilio.test/recording.mp3',
    nameTranscript: '',
    birthYearTranscript: '',
    problemTranscript: '[Voice-bot pediatrická ambulancia MUDr. Zdráhalovej]\nKategória: predpis / recept\nPožiadavka: Prosím predpísať lieky.',
    ...overrides,
  };
}

function lenerovaEvent(overrides = {}) {
  return event({
    clinicId: '172',
    routingPhoneNumber: '+421907808677',
    providerCallId: 'CAtest-mailersend-lenerova',
    nameTranscript: 'Ján Novák',
    birthYearTranscript: '1980',
    problemTranscript: '[Voice-bot psychiatrická ambulancia MUDr. Slávky Lenerovej]\nStav hovoru: dokončený\nKategória: žiadosť o opakovaný recept\nTelefón: +421900123456\nMeno a priezvisko: Ján Novák\nRok narodenia: 1980\nPožiadavka: Sertralín päťdesiat miligramov, zostávajú tri tablety.',
    ...overrides,
  });
}

test.beforeEach(() => {
  process.env.MAILERSEND_API_TOKEN = 'test-mailersend-token';
  process.env.MAILERSEND_FROM_EMAIL = 'no-reply@prixi.sk';
  process.env.MAILERSEND_FROM_NAME = 'PriXi test';
});

test.after(() => {
  for (const [key, value] of Object.entries({
    MAILERSEND_API_TOKEN: originalEnv.token,
    MAILERSEND_FROM_EMAIL: originalEnv.fromEmail,
    MAILERSEND_FROM_NAME: originalEnv.fromName,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('zaradí požiadavku MUDr. Lenerovej do samostatnej MailerSend notifikácie', async () => {
  let captured;
  const service = new MailerSendService({
    post: async (url, data, config) => {
      captured = { url, data, config };
      return { status: 202, headers: { 'x-message-id': 'mailer-message-172' } };
    },
  }, async () => { });

  assert.equal(service.isLenerovaConfigured(), true);
  assert.equal(await service.sendLenerovaRequest(lenerovaEvent()), 'mailer-message-172');

  assert.equal(captured.url, 'https://api.mailersend.com/v1/email');
  assert.deepEqual(captured.data.to, [{
    email: 'matoskok1@gmail.com',
    name: 'Psychiatrická ambulancia MUDr. Slávky Lenerovej',
  }]);
  assert.equal(captured.data.subject, '🔵 Recept – PriXi telefonická požiadavka');
  assert.match(captured.data.text, /Meno a priezvisko: Ján Novák/);
  assert.match(captured.data.text, /Rok narodenia: 1980/);
  assert.match(captured.data.text, /Telefón volajúceho: \+421900123456/);
  assert.match(captured.data.text, /POŽIADAVKA\nSertralín päťdesiat miligramov/);
  assert.doesNotMatch(captured.data.text, /\[Voice-bot/);
  assert.match(captured.data.html, /href="tel:\+421900123456"/);
  assert.equal(captured.config.headers.Authorization, 'Bearer test-mailersend-token');
});

test('zaradí požiadavku MUDr. Zdráhalovej do MailerSend fronty', async () => {
  let captured;
  const service = new MailerSendService({
    post: async (url, data, config) => {
      captured = { url, data, config };
      return { status: 202, headers: { 'x-message-id': 'mailer-message-152' } };
    },
  }, async () => { });

  const messageId = await service.sendZdrahalovaRequest(event());

  assert.equal(messageId, 'mailer-message-152');
  assert.equal(captured.url, 'https://api.mailersend.com/v1/email');
  assert.deepEqual(captured.data.from, {
    email: 'no-reply@prixi.sk',
    name: 'PriXi test',
  });
  assert.deepEqual(captured.data.to, [{
    email: 'pediatriamaneli@gmail.com',
    name: 'Detská ambulancia Maneli',
  }]);
  assert.equal(captured.data.subject, '🔵 Predpis / recept – PriXi telefonická požiadavka');
  assert.match(captured.data.text, /Telefón volajúceho: \+421900123456/);
  assert.match(captured.data.text, /Typ požiadavky: Predpis \/ recept/);
  assert.match(captured.data.text, /POŽIADAVKA\nProsím predpísať lieky\./);
  assert.doesNotMatch(captured.data.text, /\[Voice-bot/);
  assert.doesNotMatch(captured.data.text, /Nahrávka:/);
  assert.match(captured.data.text, /Prosím, neodpovedajte na tento e-mail\./);
  assert.match(captured.data.html, /font-size:20px;font-weight:700/);
  assert.match(captured.data.html, /href="tel:\+421900123456"/);
  assert.doesNotMatch(captured.data.html, /\[Voice-bot/);
  assert.doesNotMatch(captured.data.html, /Nahrávka:/);
  assert.equal(captured.config.headers.Authorization, 'Bearer test-mailersend-token');
  assert.equal(captured.config.timeout, 10_000);
});

test('použije odlišnú farebnú ikonu pre každý typ požiadavky', async () => {
  const cases = [
    ['predpis / recept', '🔵 Predpis / recept'],
    ['konzultácia', '🟠 Konzultácia'],
    ['preobjednanie preventívnej prehliadky', '🟣 Preobjednanie preventívnej prehliadky'],
    ['predoperačné vyšetrenie / kontrolné odbery', '🟢 Predoperačné vyšetrenie / kontrolné odbery'],
  ];

  for (const [category, expectedSubjectStart] of cases) {
    let payload;
    const service = new MailerSendService({
      post: async (_url, data) => {
        payload = data;
        return { status: 202, headers: { 'x-message-id': `mailer-${category}` } };
      },
    }, async () => { });

    await service.sendZdrahalovaRequest(event({
      problemTranscript: `Kategória: ${category}\nPožiadavka: Testovacia požiadavka.`,
    }));

    assert.ok(payload.subject.startsWith(expectedSubjectStart));
  }
});

test('bezpečne escapuje prepis v HTML e-maile', async () => {
  let payload;
  const service = new MailerSendService({
    post: async (_url, data) => {
      payload = data;
      return { status: 202, headers: { 'x-message-id': 'mailer-escaped-html' } };
    },
  }, async () => { });

  await service.sendZdrahalovaRequest(event({
    problemTranscript: 'Kategória: konzultácia\nPožiadavka: Dieťa má <strong>teplotu</strong> & kašeľ.',
  }));

  assert.match(payload.html, /Dieťa má &lt;strong&gt;teplotu&lt;\/strong&gt; &amp; kašeľ\./);
  assert.doesNotMatch(payload.html, /<strong>teplotu<\/strong>/);
});

test('dočasnú chybu MailerSend API zopakuje najviac trikrát', async () => {
  let attempts = 0;
  const waits = [];
  const service = new MailerSendService({
    post: async () => {
      attempts += 1;
      if (attempts < 3) throw { response: { status: 503 } };
      return { status: 202, headers: { 'x-message-id': 'mailer-after-retry' } };
    },
  }, async milliseconds => waits.push(milliseconds));

  assert.equal(await service.sendZdrahalovaRequest(event()), 'mailer-after-retry');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [250, 500]);
});

test('validačnú chybu neopakuje a do chyby nevloží API token', async () => {
  let attempts = 0;
  const service = new MailerSendService({
    post: async () => {
      attempts += 1;
      throw { response: { status: 422 } };
    },
  }, async () => assert.fail('validation failure must not wait for retry'));

  await assert.rejects(
    service.sendZdrahalovaRequest(event()),
    error => {
      assert.match(error.message, /failed \(422\)/);
      assert.doesNotMatch(error.message, /test-mailersend-token/);
      return true;
    }
  );
  assert.equal(attempts, 1);
});

test('bez tokenu alebo overeného odosielateľa nič neodošle', async () => {
  delete process.env.MAILERSEND_API_TOKEN;
  delete process.env.MAILERSEND_FROM_EMAIL;
  const service = new MailerSendService({
    post: async () => assert.fail('HTTP request must not run'),
  });

  assert.equal(service.isConfigured(), false);
  await assert.rejects(
    service.sendZdrahalovaRequest(event()),
    /credentials and sender are not configured/
  );
});
