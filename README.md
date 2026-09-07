# PriXi Voice Gateway

## Bookio voice-booking MVP

The booking flow is off by default. Enable it for a clinic by returning `bookingEnabled: true` from PriXi configuration, or temporarily set `BOOKING_ENABLED=true`.

For a safe end-to-end demonstration without Bookio credentials use `BOOKIO_MOCK_MODE=true` and `BOOKING_SMS_MOCK_MODE=true`. It offers three generated slots, creates a mock booking, and records a mock SMS confirmation. Production must keep this setting off and implement the two methods in `src/services/bookio.service.ts` from the authenticated Bookio API documentation:

- `getAvailableSlots` – availability filtered by Bookio service/calendar and date preference
- `createBooking` – atomic booking creation including the required Bookio fields and consent values

The interactive endpoints are:

- `POST /voice/booking/start`
- `POST /voice/booking/answer`
- `POST /voice/booking/retry`

They are protected by the existing Twilio request-signature hook. The session store is in memory and intentionally expires after 20 minutes; replace it with Redis before running more than one gateway instance.

The flow is SMS-first: it takes the caller's phone number from Twilio, does not ask for an email address, and sends the confirmed date and time through BulkGate. Configure `BULKGATE_APPLICATION_ID`, `BULKGATE_APPLICATION_TOKEN`, and optionally `BULKGATE_SMS_SENDER` for actual delivery. With `BOOKING_SMS_MOCK_MODE=true`, no real message is sent.

For a clear and safe IVR experience, the selected service, date preference, and slot are repeated back to the caller for confirmation. If the caller rejects one of them, the bot asks for the replacement using the telephone keypad only. The caller's name is not repeated. Marketing consent is not collected; bookings are created with that optional consent set to false. A 120-millisecond tone is played before every response from the gateway itself.

For the local manual demo, start the gateway with:

```bash
BOOKING_ENABLED=true BOOKIO_MOCK_MODE=true BOOKING_SMS_MOCK_MODE=true BOOKING_DEBUG_TOKEN="your-random-token" npm run dev
```

This remains non-production: it does not write a Bookio appointment and it does not send a real SMS.

For a local pilot, set a random `BOOKING_DEBUG_TOKEN`. After a call, retrieve its short-lived audit trail with:

```bash
curl -H "Authorization: Bearer $BOOKING_DEBUG_TOKEN" http://localhost:3000/booking/debug/<CallSid>
```

This endpoint is disabled when the debug token is absent. Its in-memory audit data is for the pilot only and must be replaced by an access-controlled PriXi audit store in production.

## Personalised Voice Bot Framework

`src/services/voice-bot-framework.service.ts` defines the reusable configuration contract for a clinic: brand and specialty, booking provider, its services and aliases, confirmation rules, DTMF fallback, terms and SMS. `bovClinicDemoConfig` is the reference template distilled from the BOV Clinic pilot.

For creating an ICP demo without editing code, run the gateway with a separate random builder token:

```bash
VOICE_BOT_BUILDER_TOKEN="your-builder-token" npm run dev
```

Then open `http://localhost:3000/admin/voice-bot-builder?token=your-builder-token`. The builder creates, validates, downloads and can save a JSON demo configuration locally in `data/voice-bot-configs/`. Saving returns a dedicated Twilio Voice webhook path in the form `/voice/demo/<bot-id>/incoming`.

The saved demo bot has the same guided phone flow as BOV Clinic, but it always uses generated mock availability and never writes to Bookio, PriXi or another calendar. It can send a real confirmation SMS only when both the normal BulkGate credentials and this explicit opt-in are present:

```bash
DEMO_BOOKING_SMS_ENABLED=true \
BULKGATE_APPLICATION_ID="..." \
BULKGATE_APPLICATION_TOKEN="..." \
BULKGATE_SMS_SENDER="PriXi" \
VOICE_BOT_BUILDER_TOKEN="your-builder-token" \
npm run dev
```

Without `DEMO_BOOKING_SMS_ENABLED=true`, the demo records a mock booking but intentionally does not send an SMS. In Twilio use your current public tunnel URL plus the webhook path shown by the Builder, for example `https://your-tunnel.trycloudflare.com/voice/demo/dentcare-bratislava-demo/incoming`.

Run verification with `npm test`.
