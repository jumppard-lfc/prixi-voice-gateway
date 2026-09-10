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

### Production call status callback

The production voicemail flow keeps a short-lived in-memory draft keyed by the
Twilio `CallSid`. Configure Twilio to send the terminal call status as an HTTP
POST to:

```text
https://<voice-gateway-host>/voice/call-status
```

This callback finalizes a request when a caller hangs up while the bot is
speaking between two recording steps. Drafts expire after 24 hours. Because the
store is intentionally in memory, an application restart or a request routed to
a different instance can lose an unfinished draft.
