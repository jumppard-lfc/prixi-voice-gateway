# PriXi Voice Gateway

## Personalised Voice Bot Framework

`src/services/voice-bot-framework.service.ts` defines the reusable configuration contract for a clinic: brand and specialty, booking provider, its services and aliases, confirmation rules, DTMF fallback, terms and SMS. `bovClinicDemoConfig` is the reference template distilled from the BOV Clinic pilot.

For creating an ICP demo without editing code, run the gateway with a separate random builder token:

```bash
VOICE_BOT_BUILDER_TOKEN="your-builder-token" npm run dev
```

Then open `http://localhost:3000/admin/voice-bot-builder?token=your-builder-token`. The builder validates and downloads a JSON demo configuration. Commit that JSON to `configs/demo-voice-bots/<bot-id>.json`; the gateway loads this versioned directory on every start, so the bot survives Render deploys and restarts.

For example, after downloading `dentcare-bratislava-demo.json`:

```bash
mv ~/Downloads/dentcare-bratislava-demo.json configs/demo-voice-bots/
git add configs/demo-voice-bots/dentcare-bratislava-demo.json
git commit -m "feat: add DentCare Bratislava demo bot"
git push
```

For a repeatable end-to-end ICP exercise — research, a safe new demo number, Builder tree, Git/Render/Twilio setup, test calls and a personalised cold email — follow [the personalised demo runbook](docs/personalized-demo-runbook.md).

After Render deploys the commit, configure the new Twilio number with the dedicated webhook path `/voice/demo/<bot-id>/incoming`.

`VOICE_BOT_CONFIG_REPOSITORY_DIR` can override the committed directory for local development or tests. `VOICE_BOT_CONFIG_DIR` is only an explicit, temporary writable override; do not set it on Render.

The saved demo bot has the same guided phone flow as BOV Clinic, but it always uses generated mock availability and never writes to Bookio, PriXi or another calendar. In a conversation tree, add a **Voľné termíny** node after the service (and optional time-preference) question. It offers three concrete mock dates/times, stores the selected one in its configured variable (for example `{{termin}}`), and can require an explicit yes/no confirmation before the end node. It can send a real confirmation SMS only when both the normal BulkGate credentials and this explicit opt-in are present:

```bash
DEMO_BOOKING_SMS_ENABLED=true \
BULKGATE_APPLICATION_ID="..." \
BULKGATE_APPLICATION_TOKEN="..." \
BULKGATE_SMS_SENDER="PriXi" \
VOICE_BOT_BUILDER_TOKEN="your-builder-token" \
npm run dev
```

Without `DEMO_BOOKING_SMS_ENABLED=true`, the demo records a mock booking but intentionally does not send an SMS. In Twilio use your current public tunnel URL plus the webhook path shown by the Builder, for example `https://your-tunnel.trycloudflare.com/voice/demo/dentcare-bratislava-demo/incoming`.

### Deterministic conversation trees

The Builder also has a **Vlastný rozhodovací strom** mode. It is intended for lead-specific demos where the clinic needs a different intake flow than the standard booking template.

- A question has an exact set of spoken aliases, one DTMF digit per answer, and an explicit next node.
- A selected answer can be confirmed with yes/no; a misunderstood response moves the caller to the keypad fallback.
- A node can carry a natural bridge sentence before its question and store its selected label for later `{{variable}}` text or SMS templates.
- End nodes either finish the call, mark a demo handoff branch, or create a mock booking and optionally send the already opt-in-gated demo SMS.
- A public HTTPS audio URL can replace TTS for a static node. The recording must contain the complete wording for that node; dynamic values still use TTS.

Existing configurations without `conversationTree` continue to use the original guided booking flow unchanged.

### Safe routing

An existing production caller is never routed to a demo based on a global environment flag or a PriXi `bookingEnabled` value. A demo bot begins only in one of two explicit ways:

1. its dedicated dynamic webhook, `/voice/demo/<bot-id>/incoming`; or
2. the shared `/voice/incoming` webhook when Twilio's destination field `To` exactly matches a dedicated number saved in `routing.inboundTwilioNumbers`.

The builder exposes this as **Dedikované Twilio číslo bota**. Existing production Twilio numbers are protected in the gateway and retain their original `fine-tuning` behaviour. Unconfigured numbers also remain on that existing flow. `provider.mode: live` is deliberately rejected by the demo endpoints until a real provider connector has been implemented and reviewed.

Run verification with `npm test`.

## MUDr. Zora Zdráhalová production bot

The Zdráhalová pediatric bot uses the dedicated Twilio DID `+420910926126` and
the clinic's public routing number `+421911135193`. The public number remains
the stable PriXi configuration key and both numbers are pinned to clinic `152`.
The bot asks the parent for the child's
name and their request in one short recording, then confirms the handoff and
ends the call. It deliberately does not add separate name, birth year,
office-hours or service-list prompts.

Configure the Twilio DID's incoming voice webhook and terminal status callback
as `POST /voice/incoming` and `POST /voice/call-status`.

### PriXi presentation demo

`configs/demo-voice-bots/prixi-prezentacia-demo.json` routes the flyer number
`+420910929535` to a speech-first demo. A caller can try a short patient
scenario or leave only their name, clinic name, clinic type and preferred
callback time. The bot does not ask for a phone number or email; callback uses
the incoming caller ID.

Completed leads are always written as structured application logs. For durable
delivery, configure an HTTPS endpoint before the event:

```bash
DEMO_LEAD_WEBHOOK_URL="https://<lead-receiver>"
DEMO_LEAD_WEBHOOK_TOKEN="<optional-bearer-token>"
```

The payload contains `name`, `clinicName`, `clinicType`,
`preferredContactTime`, `callerPhone`, `callSid`, `botId` and `capturedAt`.
Configure the Twilio number's voice webhook as `POST /voice/incoming`; the
normal dedicated-number router selects this demo configuration.

## MUDr. Peter Vadkerti production bot

The Vadkerti neurology bot is a production intake flow, not a Builder demo.
Like the other production bots, its Twilio DID posts to the single public
`/voice/incoming` webhook. The shared router identifies it from
the authoritative `To: +420910922693`. `ForwardedFrom: +421902647072` remains
available only as a carrier fallback. The router then hands the call directly
to the isolated Vadkerti flow. The clinic-specific
`/voice/vadkerti/answer` and `/voice/vadkerti/prompt` routes are internal Twilio
continuations, not incoming webhooks.

It uses the existing production settings only:

```bash
PRIXI_API_URL="https://..."
PRIXI_MOCK_MODE=false
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
```

The bot writes through the existing PriXi `/api/voice/event` integration. The
gateway maps both the authoritative Twilio DID `+420910922693` and the clinic
number `+421902647072` directly to PriXi clinic/provider `146`, before any
remote configuration lookup. This mirrors the protected mappings used by the
other production bots and does not require a Vadkerti-specific environment
variable. Keep `PRIXI_MOCK_MODE=false` in production.

The current version never reads or writes Curo. Future slot mappings are kept
inactive in `src/config/vadkerti.config.ts` for a later reviewed connector.

## MDDr. Milos Hmira production bot

The Hmira dental bot uses the same short voicemail flow as the Novotny bot: it
asks the caller for their name and request in one recording, transcribes it and
submits it through the existing PriXi `/api/voice/event` integration. The
clinic routing number is `+421948834475` and its protected Czech Twilio DID is
`+420910924407`. Both numbers are pinned to PriXi clinic `151`. Configure these
HTTP POST callbacks on that Twilio number:

```text
https://<voice-gateway-host>/voice/incoming
https://<voice-gateway-host>/voice/call-status
```

The gateway maps both the dedicated destination and carrier calls forwarded
from `+421948834475` to the protected Twilio route and rejects any configuration
that resolves it to a clinic other than `151`.

The patient-facing greeting and completion use versioned, pre-generated audio
files (`hmira-1-greeting-v1.wav` and `hmira-2-completion-v1.wav`) served by the
gateway with immutable caching. Both files are mono 8 kHz G.711 mu-law WAVs;
the original TTS copy remains as a fallback if an audio asset is unavailable.

### Production call status callback

The production voicemail flow keeps a short-lived in-memory draft keyed by the
Twilio `CallSid`. Configure Twilio to send the terminal call status as an HTTP
POST to:

```text
https://<voice-gateway-host>/voice/call-status
```

This callback finalizes a request when a caller hangs up while the bot is
speaking between two recording steps. For the Vadkerti flow it creates a
clearly marked partial request only after the caller has stated what they need;
language-only, after-hours, and urgent calls do not create one. Drafts expire
after 24 hours. Because the stores are intentionally in memory, an application
restart or a request routed to a different instance can lose an unfinished
draft.

## NEUROCENTRUM Levice production bot

The Neurocentrum bot is a separate production intake flow. EDS owns its runtime
configuration, opening/vacation status, patient-facing messages and Curo email
delivery. The gateway only conducts the call, enforces the concurrency limit
from EDS, and submits a typed `patient_request.created` event after the caller
confirms the summary. A caller requesting a first examination hears the
clinic's approved in-person instructions and no patient request is created.

Assign the dedicated Twilio DID to the provider in EDS and configure its voice
webhook and terminal status callback:

```text
POST https://<voice-gateway-host>/voice/incoming
POST https://<voice-gateway-host>/voice/call-status
```

Required production settings:

```bash
PRIXI_API_URL="https://<eds-host>"
PRIXI_API_KEY="<shared-voice-api-token>"
```

`EDS_API_URL` and `EDS_VOICE_API_TOKEN` can override those shared values for
this integration. The Twilio DID is stored in EDS rather than in the gateway
environment. The gateway calls `GET /api/voice/config?phoneNumber=...`
with Bearer authentication. A successful configuration is cached for 30
seconds and remains an eligible last-known-good fallback for five minutes.
Without a current or last-known-good configuration the gateway plays a
technical-failure message and does not start intake.

After confirmation the gateway posts this versioned contract to
`POST /api/voice/event`:

```json
{
  "event": "patient_request.created",
  "version": 1,
  "clinicId": "42",
  "callSid": "CA...",
  "occurredAt": "2026-09-20T09:15:00.000Z",
  "call": { "phone": "+421...", "durationSeconds": 84 },
  "patient": {
    "existingPatient": true,
    "firstName": "Ján",
    "lastName": "Novák",
    "birthDate": "1980-03-15"
  },
  "request": { "type": "prescription", "detail": "Tegretol..." }
}
```

The `CallSid` is also sent as `Idempotency-Key`. Transient errors are retried;
an explicit EDS duplicate response counts as success. The success message is
played only after EDS confirms durable storage. SMTP/Curo credentials and the
Curo email format never enter the gateway.

Neurocentrum settings are administered only in EDS. The former
`/admin/neurocentrum` gateway routes are intentionally not registered. The
concurrency counter remains process-local, so run a single gateway instance
until a shared call-state store is introduced.
