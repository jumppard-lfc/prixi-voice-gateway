const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const os = require('node:os');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
process.env.VOICE_BOT_BUILDER_TOKEN = 'demo-routing-builder-token';
process.env.VOICE_BOT_CONFIG_DIR = path.join(os.tmpdir(), `prixi-demo-routing-${process.pid}`);
process.env.VOICE_BOT_CONFIG_REPOSITORY_DIR = path.join(os.tmpdir(), `prixi-demo-routing-repository-${process.pid}`);

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');

const configDirectory = process.env.VOICE_BOT_CONFIG_DIR;
const repositoryConfigDirectory = process.env.VOICE_BOT_CONFIG_REPOSITORY_DIR;
const originalGetConfig = prixiService.getConfig.bind(prixiService);

function configFor(id, inboundTwilioNumbers) {
  return {
    version: 1,
    id,
    clinic: { displayName: 'DentCare Bratislava', specialty: 'zubná klinika', locale: 'sk-SK', timezone: 'Europe/Bratislava' },
    provider: { kind: 'bookio', mode: 'demo_mock' },
    routing: { inboundTwilioNumbers },
    services: [{ id: 'hygiene', label: 'Dentálna hygiena', durationMinutes: 45, voiceAliases: ['hygiena'] }],
    conversation: {
      confirmService: true, confirmDatePreference: true, confirmSlot: true, confirmName: false,
      requireTerms: true, sendConfirmationSms: true, useDtmfFallback: true, playPromptTone: true,
    },
    copy: {},
  };
}

function signature(endpoint, params) {
  return twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `https://127.0.0.1:3000${endpoint}`, params);
}

async function signedPost(endpoint, params) {
  return app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-twilio-signature': signature(endpoint, params),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

async function save(config) {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/voice-bot-builder/save',
    headers: { authorization: 'Bearer demo-routing-builder-token' },
    payload: config,
  });
  assert.equal(response.statusCode, 200);
}

test.before(async () => {
  await app.ready();
  prixiService.getConfig = async () => ({ clinicId: 'test-clinic', voiceBotEnabled: false, timezone: 'Europe/Bratislava' });
});

test.after(async () => {
  prixiService.getConfig = originalGetConfig;
  rmSync(configDirectory, { recursive: true, force: true });
  rmSync(repositoryConfigDirectory, { recursive: true, force: true });
  await app.close();
});

test('verzovaná konfigurácia z repozitára zostane dostupná bez runtime úložiska', async () => {
  const config = configFor('versioned-dentcare-demo', []);
  mkdirSync(repositoryConfigDirectory, { recursive: true });
  writeFileSync(path.join(repositoryConfigDirectory, `${config.id}.json`), `${JSON.stringify(config)}\n`);

  const params = { From: '+421900000125', CallSid: 'CA90000000000000000000000000000000' };
  const response = await signedPost(`/voice/demo/${config.id}/incoming`, params);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, new RegExp(`/voice/demo/${config.id}/start`));
});

test('dedikované Twilio číslo spustí iba jemu priradený demo bot', async () => {
  await save(configFor('dentcare-bratislava-demo', ['+420910921168']));
  const params = { From: '+421900000125', To: '+420910921168', CallSid: 'CA90000000000000000000000000000001' };

  const response = await signedPost('/voice/incoming', params);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Redirect>\/voice\/demo\/dentcare-bratislava-demo\/start<\/Redirect>/);
});

test('dynamická URL zostáva nezávisle dostupná pre ten istý demo bot', async () => {
  const params = { From: '+421900000125', CallSid: 'CA90000000000000000000000000000002' };
  const response = await signedPost('/voice/demo/dentcare-bratislava-demo/incoming', params);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Redirect>\/voice\/demo\/dentcare-bratislava-demo\/start<\/Redirect>/);
});

test('dlhý zoznam služieb uprednostní hlas a po chybe ponúkne dvojcifernú klávesnicu', async () => {
  const config = configFor('paginated-team-demo', []);
  config.services = Array.from({ length: 10 }, (_, index) => ({
    id: `sluzba-${index + 1}`,
    label: `Služba ${index + 1}`,
    durationMinutes: 30,
    voiceAliases: [`služba ${index + 1}`],
  }));
  config.practitioners = [
    { id: 'doktor-prvy', label: 'doktora Prvého', serviceIds: ['sluzba-8'], voiceAliases: ['prvý'] },
    { id: 'doktorka-druha', label: 'doktorky Druhej', serviceIds: ['sluzba-8'], voiceAliases: ['druhá'] },
  ];
  await save(config);

  const callSid = 'CA90000000000000000000000000000004';
  const start = await signedPost('/voice/demo/paginated-team-demo/start', { From: '+421900000125', CallSid: callSid });
  assert.match(start.body, /Povedzte mi, prosím, na akú návštevu sa chcete objednať/);
  assert.doesNotMatch(start.body, /Pre ďalšie možnosti stlačte 9/);

  const fallback = await signedPost('/voice/demo/paginated-team-demo/answer', { CallSid: callSid, SpeechResult: 'niečomu nerozumiem' });
  assert.match(fallback.body, /Zadajte číslo služby a potvrďte ho tlačidlom mriežka/);

  const serviceSelected = await signedPost('/voice/demo/paginated-team-demo/answer', { CallSid: callSid, Digits: '10' });
  assert.match(serviceSelected.body, /Rozumela som správne, že sa chcete objednať na Služba 10/);

  const practitionerChoice = await signedPost('/voice/demo/paginated-team-demo/answer', { CallSid: callSid, Digits: '1' });
  assert.match(practitionerChoice.body, /Poďme teraz spoločne vybrať termín/);
});

test('po potvrdení služby ponúkne zubára, ak ich má služba viac', async () => {
  const config = configFor('team-choice-demo', []);
  config.practitioners = [
    { id: 'doktor-prvy', label: 'doktora Prvého', serviceIds: ['hygiene'], voiceAliases: ['prvý'] },
    { id: 'doktorka-druha', label: 'doktorky Druhej', serviceIds: ['hygiene'], voiceAliases: ['druhá'] },
  ];
  await save(config);

  const callSid = 'CA90000000000000000000000000000005';
  await signedPost('/voice/demo/team-choice-demo/start', { From: '+421900000125', CallSid: callSid });
  await signedPost('/voice/demo/team-choice-demo/answer', { CallSid: callSid, SpeechResult: 'hygiena' });
  const practitionerChoice = await signedPost('/voice/demo/team-choice-demo/answer', { CallSid: callSid, Digits: '1' });
  assert.match(practitionerChoice.body, /Vyberte si, prosím, člena tímu/);
});

test('vlastný rozhodovací strom vedie hlasovú voľbu cez potvrdenie do správnej vetvy', async () => {
  const config = configFor('tree-conversation-demo', []);
  config.conversationTree = {
    entryNodeId: 'pomoc',
    nodes: [
      {
        id: 'pomoc', type: 'question', prompt: 'S čím vám môžem pomôcť?', storeAs: 'dovod', confirmSelection: true,
        choices: [
          { id: 'objednat', label: 'objednať sa', voiceAliases: ['objednať sa', 'chcem termín'], dtmf: '1', nextNodeId: 'navsteva' },
          { id: 'info', label: 'položiť otázku', voiceAliases: ['mám otázku'], dtmf: '2', nextNodeId: 'prepojenie' },
        ],
      },
      {
        id: 'navsteva', type: 'question', bridge: 'Ďakujem. Vyberieme si návštevu.', prompt: 'Aký typ návštevy si prajete?', storeAs: 'navsteva', confirmSelection: true,
        choices: [{ id: 'vstupne', label: 'vstupné vyšetrenie', voiceAliases: ['vstupné vyšetrenie'], dtmf: '1', nextNodeId: 'potvrdene' }],
      },
      { id: 'potvrdene', type: 'end', text: 'Vaša požiadavka na {{navsteva}} je potvrdená.', outcome: 'mock_booking' },
      { id: 'prepojenie', type: 'end', text: 'Spojím vás s kolegyňou.', outcome: 'handoff' },
    ],
  };
  await save(config);

  const callSid = 'CA90000000000000000000000000000006';
  const start = await signedPost('/voice/demo/tree-conversation-demo/start', { From: '+421900000125', CallSid: callSid });
  assert.match(start.body, /S čím vám môžem pomôcť/);

  const firstConfirmation = await signedPost('/voice/demo/tree-conversation-demo/tree/answer', { CallSid: callSid, SpeechResult: 'chcem termín' });
  assert.match(firstConfirmation.body, /Rozumela som správne, že si prajete objednať sa/);

  const visit = await signedPost('/voice/demo/tree-conversation-demo/tree/answer', { CallSid: callSid, SpeechResult: 'áno' });
  assert.match(visit.body, /Vyberieme si návštevu/);

  const secondConfirmation = await signedPost('/voice/demo/tree-conversation-demo/tree/answer', { CallSid: callSid, SpeechResult: 'vstupné vyšetrenie' });
  assert.match(secondConfirmation.body, /Rozumela som správne, že si prajete vstupné vyšetrenie/);

  const completed = await signedPost('/voice/demo/tree-conversation-demo/tree/answer', { CallSid: callSid, SpeechResult: 'áno' });
  assert.match(completed.body, /Vaša požiadavka na vstupné vyšetrenie je potvrdená/);
});

test('stromový uzol voľných termínov nechá pacienta vybrať a potvrdiť konkrétny slot', async () => {
  const config = configFor('tree-availability-demo', []);
  config.conversationTree = {
    entryNodeId: 'navsteva',
    nodes: [
      {
        id: 'navsteva', type: 'question', prompt: 'Akú návštevu si prajete?', storeAs: 'navsteva', confirmSelection: false,
        choices: [{ id: 'hygiena', label: 'dentálnu hygienu', voiceAliases: ['dentálna hygiena', 'hygiena'], dtmf: '1', nextNodeId: 'terminy' }],
      },
      {
        id: 'terminy', type: 'availability', bridge: 'Ďakujem. Pozrime sa na voľné termíny.', prompt: '', serviceVariable: 'navsteva', storeAs: 'termin',
        confirmSelection: true, nextNodeId: 'potvrdene',
      },
      { id: 'potvrdene', type: 'end', text: 'Termín {{termin}} je potvrdený.', outcome: 'mock_booking' },
    ],
  };
  await save(config);

  const callSid = 'CA90000000000000000000000000000007';
  await signedPost('/voice/demo/tree-availability-demo/start', { From: '+421900000125', CallSid: callSid });
  const slots = await signedPost('/voice/demo/tree-availability-demo/tree/answer', { CallSid: callSid, SpeechResult: 'hygiena' });
  assert.match(slots.body, /voľné termíny/);
  assert.match(slots.body, /možnosť 1/);

  const confirmation = await signedPost('/voice/demo/tree-availability-demo/tree/answer', { CallSid: callSid, Digits: '1' });
  assert.match(confirmation.body, /Rozumela som správne, že si prajete/);

  const completed = await signedPost('/voice/demo/tree-availability-demo/tree/answer', { CallSid: callSid, SpeechResult: 'áno' });
  assert.match(completed.body, /Termín .* je potvrdený/);
});

test('konfigurácia nikdy neprevezme chránené produkčné Twilio číslo', async () => {
  await save(configFor('blocked-demo-bot', ['+420910927082']));
  prixiService.getConfig = async () => ({
    clinicId: '142', voiceBotEnabled: false, timezone: 'Europe/Bratislava', pediatricMode: true,
  });

  try {
    const response = await signedPost('/voice/incoming', {
      From: '+421900000125', To: '+420910927082', CallSid: 'CA90000000000000000000000000000003',
    });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body, /blocked-demo-bot/);
    assert.match(response.body, /pediatrickej ambulancie doktorky Čelkovej/);
  } finally {
    prixiService.getConfig = async () => ({ clinicId: 'test-clinic', voiceBotEnabled: false, timezone: 'Europe/Bratislava' });
  }
});
