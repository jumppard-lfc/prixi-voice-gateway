import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bovClinicDemoConfig, VoiceBotConfig, validateVoiceBotConfig } from '../services/voice-bot-framework.service';
import { voiceBotConfigStore } from '../services/voice-bot-config.store';

function isAuthorized(request: FastifyRequest): boolean {
  const expectedToken = process.env.VOICE_BOT_BUILDER_TOKEN;
  if (!expectedToken) return false;
  const query = request.query as { token?: string };
  return request.headers.authorization === `Bearer ${expectedToken}` || query.token === expectedToken;
}

function builderPage(): string {
  const bovTemplate = JSON.stringify(bovClinicDemoConfig).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PriXi Voice Bot Builder</title>
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; background: #f4f7fb; }
  body { margin: 0; } main { max-width: 1080px; margin: 34px auto; padding: 0 20px 50px; }
  h1 { margin: 0 0 8px; font-size: 30px; } .lead { color: #526078; margin: 0 0 24px; max-width: 760px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } .card { background: white; padding: 20px; border: 1px solid #dce3ef; border-radius: 14px; box-shadow: 0 2px 7px #1d2c4a0a; }
  .wide { grid-column: 1 / -1; } h2 { margin: 0 0 14px; font-size: 17px; } label { display: block; font-size: 13px; font-weight: 650; margin: 12px 0 5px; }
  input, select, textarea { box-sizing: border-box; width: 100%; padding: 10px; border: 1px solid #b9c5d8; border-radius: 8px; background: white; font: inherit; } textarea { min-height: 140px; resize: vertical; }
  .hint { color: #65738a; font-size: 12px; margin-top: 5px; } .checks { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .checks label { font-weight: 500; margin: 0; display: flex; align-items: center; gap: 8px; } .checks input { width: auto; }
  button { border: 0; border-radius: 8px; padding: 10px 14px; font: inherit; font-weight: 650; cursor: pointer; background: #1658d4; color: white; } button.secondary { background: #e8edf6; color: #233451; } .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  pre { white-space: pre-wrap; word-break: break-word; background: #101827; color: #e8efff; border-radius: 10px; padding: 16px; min-height: 90px; max-height: 430px; overflow: auto; } .ok { color: #177243; } .error { color: #b42318; } .warning { color: #9a6700; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } .checks { grid-template-columns: 1fr; } }
</style></head><body><main>
<h1>PriXi Voice Bot Builder</h1>
<p class="lead">Vytvor bezpečný demo návrh bota pre konkrétnu kliniku. Výsledkom je JSON konfigurácia; nič sa tým ešte neaktivuje na Twilio ani v rezervačnom systéme.</p>
<div class="grid">
  <section class="card"><h2>1. Klinika a provider</h2>
    <label>Názov kliniky<input id="clinicName" placeholder="DentCare Bratislava"></label>
    <label>Odbor<input id="specialty" value="zubná klinika"></label>
    <label>Telefónne číslo pre budúce priradenie<input id="phoneNumber" placeholder="+421900123456"></label>
    <label>Booking provider<select id="provider"><option value="bookio">Bookio</option><option value="prixi">PriXi kalendár</option><option value="calendly">Calendly</option><option value="custom">Iný systém / vlastný konektor</option></select></label>
    <label>Technické ID bota<input id="botId" placeholder="dentcare-bratislava-demo"></label><p class="hint">Použi malé písmená, čísla a pomlčky. Toto ID prepája demo, provider connector a Twilio číslo.</p>
  </section>
  <section class="card"><h2>2. Pravidlá rozhovoru</h2><div class="checks">
    <label><input id="confirmService" type="checkbox" checked>Potvrdiť službu</label>
    <label><input id="confirmDatePreference" type="checkbox" checked>Potvrdiť preferenciu termínu</label>
    <label><input id="confirmSlot" type="checkbox" checked>Potvrdiť konkrétny termín</label>
    <label><input id="confirmName" type="checkbox">Potvrdiť meno</label>
    <label><input id="requireTerms" type="checkbox" checked>Vyžiadať VOP</label>
    <label><input id="sendConfirmationSms" type="checkbox" checked>Poslať potvrdenie SMS</label>
    <label><input id="useDtmfFallback" type="checkbox" checked>Po chybe prepnúť na tlačidlá</label>
    <label><input id="playPromptTone" type="checkbox" checked>Prehrať krátke pípnutie</label>
  </div><p class="hint">Pre zubné kliniky odporúčame potvrdzovať službu a termín, ale nie meno. Pri nepochopení hlasu vždy ponúkni klávesnicu.</p></section>
  <section class="card wide"><h2>3. Služby kliniky</h2>
    <textarea id="services" spellcheck="false" placeholder="Preventívna prehliadka | 20 | preventive | preventívka,prehliadka\nDentálna hygiena | 45 | hygiene | hygiena\nAkútne ošetrenie | 30 | acute | bolesť zuba,akútne"></textarea>
    <p class="hint">Jeden riadok = <strong>názov služby | minúty | ID služby u providera | hlasové synonymá oddelené čiarkou</strong>. Provider ID môže zatiaľ zostať prázdne.</p>
    <label>Vlastný úvod (nepovinné)<textarea id="introduction" placeholder="Nechaj prázdne pre odporúčaný transparentný úvod."></textarea></label>
  </section>
  <section class="card wide"><h2>4. Skontroluj a exportuj</h2>
    <div class="actions"><button id="loadBov" class="secondary">Načítať BOV ukážku</button><button id="validate">Overiť konfiguráciu</button><button id="save">Uložiť demo bot</button><button id="download" class="secondary">Stiahnuť JSON</button></div>
    <label>Načítať už uložený bot podľa ID<input id="existingBotId" placeholder="dentcare-bratislava-demo"></label>
    <div class="actions"><button id="loadSaved" class="secondary">Načítať uložený bot</button><label class="secondary" style="display:inline-flex;align-items:center;cursor:pointer;padding:10px 14px;border-radius:8px;font-weight:650">Importovať JSON<input id="importJson" type="file" accept="application/json" style="display:none"></label></div>
    <div id="feedback" class="hint"></div><pre id="output">Vyplň kliniku a služby, potom klikni na „Overiť konfiguráciu“.</pre>
  </section>
</div></main>
<script>
const bov = ${bovTemplate};
const token = new URLSearchParams(location.search).get('token') || '';
const $ = (id) => document.getElementById(id);
const checked = (id) => $(id).checked;
const setValue = (id, value) => { $(id).value = value || ''; };
function slugify(value) { return value.toLocaleLowerCase('sk').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
function servicesFromText() { return $('services').value.split('\\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [label = '', minutes = '', providerServiceId = '', aliases = ''] = line.split('|').map((part) => part.trim()); return { id: slugify(label), label, durationMinutes: Number(minutes) || undefined, providerServiceId: providerServiceId || undefined, voiceAliases: aliases.split(',').map((item) => item.trim()).filter(Boolean) }; }); }
function config() { const clinicName = $('clinicName').value.trim(); const services = servicesFromText(); return { version: 1, id: $('botId').value.trim() || slugify(clinicName), clinic: { displayName: clinicName, specialty: $('specialty').value.trim(), phoneNumber: $('phoneNumber').value.trim() || undefined, locale: 'sk-SK', timezone: 'Europe/Bratislava' }, provider: { kind: $('provider').value, mode: 'demo_mock' }, services, conversation: { confirmService: checked('confirmService'), confirmDatePreference: checked('confirmDatePreference'), confirmSlot: checked('confirmSlot'), confirmName: checked('confirmName'), requireTerms: checked('requireTerms'), sendConfirmationSms: checked('sendConfirmationSms'), useDtmfFallback: checked('useDtmfFallback'), playPromptTone: checked('playPromptTone') }, copy: { introduction: $('introduction').value.trim() || undefined } }; }
function load(data) { setValue('clinicName', data.clinic.displayName); setValue('specialty', data.clinic.specialty); setValue('phoneNumber', data.clinic.phoneNumber); setValue('botId', data.id); setValue('provider', data.provider.kind); setValue('introduction', data.copy.introduction); setValue('services', data.services.map((s) => [s.label, s.durationMinutes || '', s.providerServiceId || '', s.voiceAliases.join(',')].join(' | ')).join('\\n')); Object.entries(data.conversation).forEach(([key, value]) => { if ($(key)) $(key).checked = Boolean(value); }); }
function showResult(result) { const feedback = $('feedback'); const lines = []; if (result.valid) lines.push('<span class="ok">Konfigurácia je pripravená pre demo.</span>'); if (result.errors.length) lines.push('<span class="error">' + result.errors.join('<br>') + '</span>'); if (result.warnings.length) lines.push('<span class="warning">' + result.warnings.join('<br>') + '</span>'); feedback.innerHTML = lines.join('<br>'); $('output').textContent = JSON.stringify(result.config, null, 2); }
async function validate() { const data = config(); const response = await fetch('/admin/voice-bot-builder/validate', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token }, body: JSON.stringify(data) }); if (!response.ok) { $('feedback').innerHTML = '<span class="error">Builder nie je autorizovaný. Spusti gateway s VOICE_BOT_BUILDER_TOKEN a otvor URL s ?token=...</span>'; return; } showResult(await response.json()); }
async function save() { const data = config(); const response = await fetch('/admin/voice-bot-builder/save', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token }, body: JSON.stringify(data) }); if (!response.ok) { const result = await response.json().catch(() => ({})); $('feedback').innerHTML = '<span class="error">' + (result.message || 'Konfiguráciu sa nepodarilo uložiť.') + '</span>'; return; } const result = await response.json(); $('feedback').innerHTML = '<span class="ok">Demo bot je uložený. Nastav vo Twilio tento Voice webhook:</span><br><code>' + result.webhookPath + '</code><br><span class="hint">Pre reálnu SMS zapni DEMO_BOOKING_SMS_ENABLED=true a nakonfiguruj BulkGate.</span>'; $('output').textContent = JSON.stringify(result.config, null, 2); }
async function loadSaved() { const id = $('existingBotId').value.trim(); if (!id) return; const response = await fetch('/admin/voice-bot-builder/config/' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + token } }); if (!response.ok) { $('feedback').innerHTML = '<span class="error">Uložený bot sa nenašiel.</span>'; return; } const result = await response.json(); load(result.config); validate(); }
$('clinicName').addEventListener('input', () => { if (!$('botId').value) $('botId').value = slugify($('clinicName').value); });
$('loadBov').onclick = () => { load(bov); validate(); }; $('validate').onclick = validate; $('save').onclick = save; $('loadSaved').onclick = loadSaved;
$('importJson').onchange = async (event) => { const file = event.target.files && event.target.files[0]; if (!file) return; try { load(JSON.parse(await file.text())); validate(); } catch { $('feedback').innerHTML = '<span class="error">Tento súbor nie je platná JSON konfigurácia bota.</span>'; } };
$('download').onclick = () => { const blob = new Blob([JSON.stringify(config(), null, 2)], { type: 'application/json' }); const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: (config().id || 'prixi-voice-bot') + '.json' }); link.click(); URL.revokeObjectURL(link.href); };
</script></body></html>`;
}

export async function voiceBotBuilderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/admin/voice-bot-builder', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(404).send();
    return reply.type('text/html; charset=utf-8').send(builderPage());
  });

  fastify.post('/admin/voice-bot-builder/validate', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(404).send();
    const config = request.body as VoiceBotConfig;
    return { ...validateVoiceBotConfig(config), config };
  });

  fastify.post('/admin/voice-bot-builder/save', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(404).send();
    const config = request.body as VoiceBotConfig;
    const validation = validateVoiceBotConfig(config);
    if (!validation.valid) return reply.code(400).send({ message: validation.errors.join(' ') });
    await voiceBotConfigStore.save(config);
    return { config, webhookPath: `/voice/demo/${config.id}/incoming` };
  });

  fastify.get('/admin/voice-bot-builder/config/:botId', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(404).send();
    const botId = (request.params as { botId: string }).botId;
    const config = await voiceBotConfigStore.get(botId);
    if (!config) return reply.code(404).send({ message: 'Demo bot was not found.' });
    return { config };
  });
}
