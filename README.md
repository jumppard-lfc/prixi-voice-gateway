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

The flow is SMS-first: it takes the caller's phone number from Twilio, does not ask for an email address, and sends the confirmed date and time through BulkGate. Configure `BULKGATE_APPLICATION_ID`, `BULKGATE_APPLICATION_TOKEN`, and optionally `BULKGATE_SMS_SENDER` for actual delivery.

For a local pilot, set a random `BOOKING_DEBUG_TOKEN`. After a call, retrieve its short-lived audit trail with:

```bash
curl -H "Authorization: Bearer $BOOKING_DEBUG_TOKEN" http://localhost:3000/booking/debug/<CallSid>
```

This endpoint is disabled when the debug token is absent. Its in-memory audit data is for the pilot only and must be replaced by an access-controlled PriXi audit store in production.

Run verification with `npm test`.
