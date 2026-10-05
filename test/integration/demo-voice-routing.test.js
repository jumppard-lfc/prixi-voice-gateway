const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const path = require('node:path');
const os = require('node:os');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
process.env.VOICE_BOT_BUILDER_TOKEN = 'demo-routing-builder-token';
process.env.VOICE_BOT_CONFIG_DIR = path.join(os.tmpdir(), `prixi-demo-routing-${process.pid}`);
process.env.VOICE_BOT_CONFIG_REPOSITORY_DIR = path.join(os.tmpdir(), `prixi-demo-routing-repository-${process.pid}`);

const app = require('../../src/app').default;
const { prixiService } = require('../../src/services/prixi.service');
const { validateVoiceBotConfig } = require('../../src/services/voice-bot-framework.service');
const { bookingAuditService } = require('../../src/services/booking-audit.service');
const { demoLeadService } = require('../../src/services/demo-lead.service');

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

function gatherAction(twiml) {
  const match = twiml.match(/<Gather[^>]+action="([^"]+)"/);
  assert.ok(match, 'TwiML musí obsahovať Gather action');
  return match[1].replace(/&amp;/g, '&');
}

function gatherAttribute(twiml, attribute) {
  const match = twiml.match(new RegExp(`<Gather[^>]+${attribute}="([^"]+)"`));
  assert.ok(match, `Gather musí obsahovať atribút ${attribute}`);
  return match[1].replace(/&amp;/g, '&');
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
  assert.doesNotMatch(start.body, /Pre ďalšie možnosti stlačte deviatku/);

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
  assert.equal((visit.body.match(/Ďakujem\./g) || []).length, 1);

  const secondConfirmation = await signedPost('/voice/demo/tree-conversation-demo/tree/answer', { CallSid: callSid, SpeechResult: 'vstupné vyšetrenie' });
  assert.match(secondConfirmation.body, /Rozumela som správne, že si prajete vstupné vyšetrenie/);

  const completed = await signedPost('/voice/demo/tree-conversation-demo/tree/answer', { CallSid: callSid, SpeechResult: 'áno' });
  assert.match(completed.body, /Vaša požiadavka na vstupné vyšetrenie je potvrdená/);
});

test('prezentačný strom zachytí voľné hlasové údaje a vytvorí lead bez pýtania telefónu či emailu', async () => {
  const config = configFor('presentation-lead-demo', []);
  config.conversation.sendConfirmationSms = false;
  config.copy.questionProsody = { pitch: '+5%', rate: '96%', pauseMs: 180 };
  config.conversationTree = {
    entryNodeId: 'meno',
    nodes: [
      {
        id: 'meno', type: 'input', prompt: 'Ako sa voláte?', storeAs: 'name', confirmInput: true,
        confirmationPrompt: 'Zachytila som {{selected}}. Je to správne?', nextNodeId: 'ambulancia',
      },
      {
        id: 'ambulancia', type: 'input', prompt: 'Ako sa volá ambulancia?', storeAs: 'clinicName', confirmInput: false,
        nextNodeId: 'typ',
      },
      {
        id: 'typ', type: 'question', prompt: 'Aký je typ ambulancie?', storeAs: 'clinicType', confirmSelection: false,
        choices: [{ id: 'zubna', label: 'zubná ambulancia', voiceAliases: ['zubná'], dtmf: '1', nextNodeId: 'cas' }],
      },
      {
        id: 'cas', type: 'question', prompt: 'Kedy vám máme zavolať?', storeAs: 'preferredContactTime', confirmSelection: false,
        choices: [{ id: 'poobede', label: 'popoludní', voiceAliases: ['poobede'], dtmf: '1', nextNodeId: 'koniec' }],
      },
      { id: 'koniec', type: 'end', text: 'Ďakujem, {{name}} z {{clinicName}}.', outcome: 'lead' },
    ],
  };
  await save(config);

  const callSid = 'CA90000000000000000000000000000014';
  const start = await signedPost('/voice/demo/presentation-lead-demo/start', { From: '+421900000125', CallSid: callSid });
  assert.match(start.body, /Ako sa voláte/);
  assert.match(start.body, /<break time="180ms"\/?>/);
  assert.match(start.body, /<prosody pitch="\+5%" rate="96%">Ako sa voláte\?<\/prosody>/);
  assert.doesNotMatch(start.body, /telefón|email/i);

  const confirmName = await signedPost('/voice/demo/presentation-lead-demo/tree/answer', { CallSid: callSid, SpeechResult: 'Jana Nováková' });
  assert.match(confirmName.body, /Zachytila som Jana Nováková/);
  const clinic = await signedPost('/voice/demo/presentation-lead-demo/tree/answer', { CallSid: callSid, SpeechResult: 'áno' });
  assert.match(clinic.body, /Ako sa volá ambulancia/);
  const type = await signedPost('/voice/demo/presentation-lead-demo/tree/answer', { CallSid: callSid, SpeechResult: 'Medika Plus' });
  assert.match(type.body, /Aký je typ ambulancie/);
  const time = await signedPost('/voice/demo/presentation-lead-demo/tree/answer', { CallSid: callSid, SpeechResult: 'zubná' });
  assert.match(time.body, /Kedy vám máme zavolať/);
  const completed = await signedPost('/voice/demo/presentation-lead-demo/tree/answer', { CallSid: callSid, SpeechResult: 'poobede' });
  assert.match(completed.body, /Ďakujem, Jana Nováková z Medika Plus/);

  const events = bookingAuditService.get(callSid) || [];
  assert.equal(events.filter((event) => event.event === 'tree_input_collected').length, 2);
  assert.equal(events.some((event) => event.event === 'lead_collected'), true);
});

test('salónové demo je platné a smeruje slovenské letákové číslo', async () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, '../../configs/demo-voice-bots/prixi-salony-stupava-demo.json'), 'utf8'));
  const validation = validateVoiceBotConfig(config);
  assert.equal(validation.valid, true, validation.errors.join(' '));
  await save(config);

  const params = { From: '+421900000125', To: '+421800223160', CallSid: 'CA-SALON-ROUTING-1' };
  const response = await signedPost('/voice/incoming', params);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<Redirect>\/voice\/demo\/prixi-salony-stupava-demo\/start<\/Redirect>/);
});

test('salónové demo zachráni priebežný lead po zložení počas poslednej odpovede', async () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, '../../configs/demo-voice-bots/prixi-salony-stupava-demo.json'), 'utf8'));
  config.id = 'salon-abandoned-lead-demo';
  config.routing.inboundTwilioNumbers = [];
  await save(config);

  const submitted = [];
  const drafts = [];
  const originalSubmit = demoLeadService.submit.bind(demoLeadService);
  const originalCaptureDraft = demoLeadService.captureDraft.bind(demoLeadService);
  demoLeadService.submit = async (lead) => {
    submitted.push(lead);
    return 'log';
  };
  demoLeadService.captureDraft = (lead) => drafts.push(lead);

  try {
    const callSid = 'CA-SALON-ABANDONED-1';
    const start = await signedPost(`/voice/demo/${config.id}/start`, { From: '+421900000125', CallSid: callSid });
    const leadQuestion = await signedPost(gatherAction(start.body), { From: '+421900000125', CallSid: callSid, Digits: '2' });
    assert.match(leadQuestion.body, /svoje meno, názov prevádzky/);

    const partialAbsoluteUrl = gatherAttribute(leadQuestion.body, 'partialResultCallback');
    const partialUrl = new URL(partialAbsoluteUrl);
    const partial = await signedPost(`${partialUrl.pathname}${partialUrl.search}`, {
      From: '+421900000125',
      CallSid: callSid,
      UnstableSpeechResult: 'Jana Nováková, salón Bella, najlepšie popoludní',
    });
    assert.equal(partial.statusCode, 204);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, 'draft');
    assert.equal(drafts[0].leadDetails, 'Jana Nováková, salón Bella, najlepšie popoludní');
    assert.equal(drafts[0].transcriptStatus, 'unstable');

    const status = await signedPost('/voice/call-status', {
      From: '+421900000125',
      To: '+421800223160',
      CallSid: callSid,
      CallStatus: 'completed',
    });
    assert.equal(status.statusCode, 204);
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].status, 'abandoned');
    assert.equal(submitted[0].leadDetails, 'Jana Nováková, salón Bella, najlepšie popoludní');
    assert.equal(submitted[0].callerPhone, '+421900000125');
  } finally {
    demoLeadService.submit = originalSubmit;
    demoLeadService.captureDraft = originalCaptureDraft;
  }
});

test('dokončený salónový lead sa uloží bez potvrdenia a status callback ho neduplikuje', async () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, '../../configs/demo-voice-bots/prixi-salony-stupava-demo.json'), 'utf8'));
  config.id = 'salon-complete-lead-demo';
  config.routing.inboundTwilioNumbers = [];
  await save(config);

  const submitted = [];
  const originalSubmit = demoLeadService.submit.bind(demoLeadService);
  demoLeadService.submit = async (lead) => {
    submitted.push(lead);
    return 'log';
  };

  try {
    const callSid = 'CA-SALON-COMPLETE-1';
    const start = await signedPost(`/voice/demo/${config.id}/start`, { From: '+421900000126', CallSid: callSid });
    const leadQuestion = await signedPost(gatherAction(start.body), { From: '+421900000126', CallSid: callSid, Digits: '2' });
    const completed = await signedPost(gatherAction(leadQuestion.body), {
      From: '+421900000126',
      CallSid: callSid,
      SpeechResult: 'Peter Horváth, Barber Stupava, dopoludnia',
    });

    assert.match(completed.body, /Matej sa vám ozve v čase/);
    assert.doesNotMatch(completed.body, /Je to správne/);
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].status, 'complete');
    assert.equal(submitted[0].leadDetails, 'Peter Horváth, Barber Stupava, dopoludnia');

    await signedPost('/voice/call-status', {
      From: '+421900000126',
      To: '+421800223160',
      CallSid: callSid,
      CallStatus: 'completed',
    });
    assert.equal(submitted.length, 1);
  } finally {
    demoLeadService.submit = originalSubmit;
  }
});

test('stav stromu prežije presmerovanie každého kroku na inú Render inštanciu', async () => {
  const config = configFor('portable-tree-state-demo', []);
  config.conversationTree = {
    entryNodeId: 'uvod',
    nodes: [
      {
        id: 'uvod', type: 'question', prompt: 'Pacient alebo ambulancia?', storeAs: 'mode', confirmSelection: false,
        choices: [{ id: 'ambulancia', label: 'ambulancia', voiceAliases: ['v mojej ambulancii'], dtmf: '1', nextNodeId: 'meno' }],
      },
      { id: 'meno', type: 'input', prompt: 'Ako sa voláte?', storeAs: 'name', confirmInput: false, nextNodeId: 'klinika' },
      { id: 'klinika', type: 'input', prompt: 'Ako sa volá klinika?', storeAs: 'clinicName', confirmInput: false, nextNodeId: 'koniec' },
      { id: 'koniec', type: 'end', text: 'Ďakujem {{name}} z {{clinicName}}.', outcome: 'complete' },
    ],
  };
  await save(config);

  const start = await signedPost('/voice/demo/portable-tree-state-demo/start', { From: '+421900000125', CallSid: 'CA-PORTABLE-1' });
  const afterChoice = await signedPost(gatherAction(start.body), { From: '+421900000125', CallSid: 'CA-PORTABLE-2', SpeechResult: 'v mojej ambulancii' });
  assert.match(afterChoice.body, /Ako sa voláte/);
  assert.doesNotMatch(afterChoice.body, /Platnosť hovoru vypršala/);

  const afterName = await signedPost(gatherAction(afterChoice.body), { From: '+421900000125', CallSid: 'CA-PORTABLE-3', SpeechResult: 'Jana Nováková' });
  assert.match(afterName.body, /Ako sa volá klinika/);
  assert.doesNotMatch(gatherAction(afterName.body), /Jana|SmFuYQ/);
  const completed = await signedPost(gatherAction(afterName.body), { From: '+421900000125', CallSid: 'CA-PORTABLE-4', SpeechResult: 'Medika Plus' });
  assert.match(completed.body, /Ďakujem Jana Nováková z Medika Plus/);
});

test('eLHa dent rozpozná zubný šperk aj pri českom prepise od STT', async () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, '../../configs/demo-voice-bots/elha-dent-odorin-demo.json'), 'utf8'));
  await save(config);

  const slovakCallSid = 'CA90000000000000000000000000000012';
  await signedPost(`/voice/demo/${config.id}/start`, { From: '+421900000125', CallSid: slovakCallSid });
  const slovakSelection = await signedPost(`/voice/demo/${config.id}/tree/answer`, { CallSid: slovakCallSid, SpeechResult: 'zubny sperk' });
  assert.match(slovakSelection.body, /zubný šperk/);

  const czechCallSid = 'CA90000000000000000000000000000013';
  await signedPost(`/voice/demo/${config.id}/start`, { From: '+421900000125', CallSid: czechCallSid });
  const czechSelection = await signedPost(`/voice/demo/${config.id}/tree/answer`, { CallSid: czechCallSid, SpeechResult: 'zubní šperk' });
  assert.match(czechSelection.body, /zubný šperk/);
});

test('strom rozpozná prirodzenú zmenu slovosledu a po chybe neopakuje úvod', async () => {
  const config = configFor('tree-retry-demo', []);
  config.conversationTree = {
    entryNodeId: 'uvod',
    nodes: [
      {
        id: 'uvod', type: 'question', prompt: 'Dobrý deň, vítajte v ambulancii. Chcete sa objednať na návštevu alebo máte otázku?',
        retryPrompt: 'Zopakujem možnosti. Pre objednanie stlačte jednotku. Pre otázku stlačte dvojku.', storeAs: 'dovod', confirmSelection: false,
        choices: [
          { id: 'objednanie', label: 'objednať sa na návštevu', voiceAliases: ['objednať sa', 'chcem termín'], dtmf: '1', nextNodeId: 'objednane' },
          { id: 'otazka', label: 'máte otázku', voiceAliases: ['otázka'], dtmf: '2', nextNodeId: 'otazka' },
        ],
      },
      { id: 'objednane', type: 'end', text: 'Pokračujeme v objednaní.', outcome: 'complete' },
      { id: 'otazka', type: 'end', text: 'Vypočujem si vašu otázku.', outcome: 'handoff' },
    ],
  };
  await save(config);

  const acceptedCallSid = 'CA90000000000000000000000000000008';
  await signedPost('/voice/demo/tree-retry-demo/start', { From: '+421900000125', CallSid: acceptedCallSid });
  const accepted = await signedPost('/voice/demo/tree-retry-demo/tree/answer', { CallSid: acceptedCallSid, SpeechResult: 'chcem sa objednať na návštevu' });
  assert.match(accepted.body, /Pokračujeme v objednaní/);

  const retryCallSid = 'CA90000000000000000000000000000009';
  await signedPost('/voice/demo/tree-retry-demo/start', { From: '+421900000125', CallSid: retryCallSid });
  const retry = await signedPost('/voice/demo/tree-retry-demo/tree/answer', { CallSid: retryCallSid, SpeechResult: 'niečomu vôbec nerozumiem' });
  assert.match(retry.body, /Prepáčte, nerozumela som/);
  assert.match(retry.body, /Zopakujem možnosti. Pre objednanie stlačte jednotku/);
  assert.doesNotMatch(retry.body, /Dobrý deň, vítajte v ambulancii/);
});

test('strom rozpozná slovenský skloňovaný tvar služby', async () => {
  const config = configFor('tree-inflection-demo', []);
  config.conversationTree = {
    entryNodeId: 'sluzba',
    nodes: [
      {
        id: 'sluzba', type: 'question', prompt: 'Akú službu si prajete?', storeAs: 'sluzba', confirmSelection: false,
        choices: [{ id: 'hygiena', label: 'dentálna hygiena', voiceAliases: ['hygiena'], dtmf: '1', nextNodeId: 'koniec' }],
      },
      { id: 'koniec', type: 'end', text: 'Vybrali ste {{sluzba}}.', outcome: 'complete' },
    ],
  };
  await save(config);

  const callSid = 'CA90000000000000000000000000000010';
  await signedPost('/voice/demo/tree-inflection-demo/start', { From: '+421900000125', CallSid: callSid });
  const selected = await signedPost('/voice/demo/tree-inflection-demo/tree/answer', { CallSid: callSid, SpeechResult: 'mám záujem o dentálnu hygienu' });
  assert.match(selected.body, /Vybrali ste dentálna hygiena/);
});

test('výber tlačidlom okamžite pokračuje bez hlasového potvrdenia', async () => {
  const config = configFor('tree-dtmf-demo', []);
  config.conversationTree = {
    entryNodeId: 'sluzba',
    nodes: [
      {
        id: 'sluzba', type: 'question', prompt: 'Akú službu si prajete?', storeAs: 'sluzba', confirmSelection: true,
        choices: [{ id: 'hygiena', label: 'dentálnu hygienu', voiceAliases: ['hygiena'], dtmf: '1', nextNodeId: 'koniec' }],
      },
      { id: 'koniec', type: 'end', text: 'Rezerváciu dokončíme.', outcome: 'complete' },
    ],
  };
  await save(config);

  const callSid = 'CA90000000000000000000000000000011';
  await signedPost('/voice/demo/tree-dtmf-demo/start', { From: '+421900000125', CallSid: callSid });
  const selected = await signedPost('/voice/demo/tree-dtmf-demo/tree/answer', { CallSid: callSid, Digits: '1' });
  assert.match(selected.body, /Rezerváciu dokončíme/);
  assert.doesNotMatch(selected.body, /Rozumela som správne/);
});

test('validácia odmietne rovnaké hlasové synonymum pri dvoch voľbách', () => {
  const config = configFor('duplicate-alias-demo', []);
  config.conversationTree = {
    entryNodeId: 'sluzba',
    nodes: [
      {
        id: 'sluzba', type: 'question', prompt: 'Akú službu si prajete?', confirmSelection: false,
        choices: [
          { id: 'hygiena', label: 'Dentálna hygiena', voiceAliases: ['hygiena'], dtmf: '1', nextNodeId: 'koniec' },
          { id: 'bielenie', label: 'Bielenie zubov', voiceAliases: ['bielenie', 'hygiena'], dtmf: '2', nextNodeId: 'koniec' },
        ],
      },
      { id: 'koniec', type: 'end', text: 'Ďakujeme.', outcome: 'complete' },
    ],
  };

  const validation = validateVoiceBotConfig(config);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /hygiena/);
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

  const completed = await signedPost('/voice/demo/tree-availability-demo/tree/answer', { CallSid: callSid, Digits: '1' });
  assert.match(completed.body, /Termín .* je potvrdený/);
  assert.doesNotMatch(completed.body, /Rozumela som správne/);
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
