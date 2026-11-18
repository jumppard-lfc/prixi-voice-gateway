# MUDr. Ján Štefančík — daily digest contract

This contract describes the PriXi backend work that is intentionally outside
the stateless voice gateway.

## Trigger

An external scheduler calls the PriXi backend on working days at 10:30 in the
`Europe/Bratislava` timezone:

```http
POST /api/internal/voice/digests/stefancik
Authorization: Bearer <cron secret>
Idempotency-Key: stefancik-digest-YYYY-MM-DD
Content-Type: application/json

{
  "date": "YYYY-MM-DD"
}
```

The supplied date is interpreted in `Europe/Bratislava`. The backend must reject
dates other than the current local date, or derive the date server-side and
ignore the body. The endpoint must never be publicly callable without the cron
credential.

## Database query

Select only requests that satisfy all of the following:

- clinic ID is `171`;
- source is the MUDr. Štefančík voice assistant;
- local creation date is the requested date;
- local creation time is at or before 10:30;
- category is one of `appointment`, `results`, `prescription`, `office_hours`.

The voice gateway already refuses to persist Štefančík requests outside the
working-day intake window 07:30–10:30. The backend time constraint is a second
safety boundary, not the primary filter.

The current voice event carries a stable Slovak category label in
`problemTranscript`. Prefer adding a typed request-category column during the
backend implementation instead of permanently parsing display text.

## Email

Recipient: `urolinestupava@gmail.com`

Order sections and their items as follows:

1. A) Žiadosť o termín
2. B) Žiadosť o výsledky
3. C) Žiadosť o lieky / recept
4. D) Ordinačné hodiny

Within each section sort by creation time ascending. Include the time, caller
phone number and captured detail. An empty category may be shown as
`bez požiadaviek`.

## Idempotency and failure handling

Persist a delivery record with a unique key such as:

```text
(clinic_id, digest_type, local_date)
```

Acquire that key before sending. Repeated cron calls for an already delivered
date return success with status `already_sent` and do not send another email.
Do not mark the delivery as sent until the email provider accepts it. Store the
provider message ID and timestamps for auditability.

Suggested responses:

```json
{ "status": "sent", "date": "YYYY-MM-DD", "requestCount": 4, "messageId": "..." }
```

```json
{ "status": "already_sent", "date": "YYYY-MM-DD" }
```

Temporary email-provider or database failures should return a non-2xx response
so the scheduler can retry with the same idempotency key.
