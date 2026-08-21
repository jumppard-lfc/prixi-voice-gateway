# PriXi Voice Gateway

## Bookio voice-booking MVP

The booking flow is off by default. Enable it for a clinic by returning `bookingEnabled: true` from PriXi configuration, or temporarily set `BOOKING_ENABLED=true`.

For a safe end-to-end demonstration without Bookio credentials use `BOOKIO_MOCK_MODE=true`. It offers three generated slots and creates a mock booking. Production must keep this setting off and implement the two methods in `src/services/bookio.service.ts` from the authenticated Bookio API documentation:

- `getAvailableSlots` – availability filtered by Bookio service/calendar and date preference
- `createBooking` – atomic booking creation including the required Bookio fields and consent values

The interactive endpoints are:

- `POST /voice/booking/start`
- `POST /voice/booking/answer`
- `POST /voice/booking/retry`

They are protected by the existing Twilio request-signature hook. The session store is in memory and intentionally expires after 20 minutes; replace it with Redis before running more than one gateway instance.

Run verification with `npm test`.
