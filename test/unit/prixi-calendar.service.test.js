const test = require('node:test');
const assert = require('node:assert/strict');
const { PrixiCalendarServiceClient } = require('../../src/services/prixi-calendar.service');

test('Calendar klient načíta iba platné služby a kalendáre', async () => {
  const client = new PrixiCalendarServiceClient({
    get: async path => {
      assert.equal(path, '/api/calendar/services');
      return { data: { services: [
        {
          eventTypeUid: 'preventive-exam',
          name: 'Preventívna prehliadka',
          calendars: [{ calendarId: 7, calendarName: 'Lekár', eventTypeId: 21, durationMinutes: 30 }],
        },
        { name: 'Neplatná služba bez UID', calendars: [] },
      ] } };
    },
  });

  assert.deepEqual(await client.listServices(168), [{
    eventTypeUid: 'preventive-exam',
    name: 'Preventívna prehliadka',
    calendars: [{ calendarId: 7, calendarName: 'Lekár', eventTypeId: 21, durationMinutes: 30 }],
  }]);
});

test('Calendar klient rozbalí zoskupený slot na konkrétne kalendárové možnosti', async () => {
  const client = new PrixiCalendarServiceClient({
    get: async () => ({ data: { slots: [{
      startAt: '2026-11-16T09:00:00+01:00',
      options: [
        { calendarId: 8, calendarName: 'Lekár B', durationMinutes: 45 },
        { calendarId: 7, calendarName: 'Lekár A', durationMinutes: 30 },
      ],
    }] } }),
  });

  assert.deepEqual(await client.getAvailableSlots({ clinicId: 168, eventTypeUid: 'preventive-exam', from: '2026-11-12', to: '2026-12-12' }), [
    { startAt: '2026-11-16T09:00:00+01:00', calendarId: 8, calendarName: 'Lekár B', eventTypeId: undefined, durationMinutes: 45 },
    { startAt: '2026-11-16T09:00:00+01:00', calendarId: 7, calendarName: 'Lekár A', eventTypeId: undefined, durationMinutes: 30 },
  ]);
});

test('Calendar klient posiela idempotency kľúč a mapuje obsadený slot', async () => {
  let captured;
  const successClient = new PrixiCalendarServiceClient({
    post: async (path, payload, options) => {
      captured = { path, payload, options };
      return { data: { success: true, booking: { id: 456, startAt: payload.startAt } } };
    },
  });
  const input = {
    clinicId: 168,
    calendarId: 7,
    eventTypeUid: 'preventive-exam',
    startAt: '2026-11-16T09:00:00+01:00',
    patient: { name: 'Ján', surname: 'Novák', phone_number: '+421900000000' },
    metadata: { source: 'voice_bot', externalReference: 'CA123' },
    idempotencyKey: 'same-key',
  };
  assert.equal((await successClient.createBooking(input)).status, 'created');
  assert.equal(captured.options.headers['Idempotency-Key'], 'same-key');
  assert.equal(captured.payload.sendNotification, false);

  const conflictClient = new PrixiCalendarServiceClient({
    post: async () => {
      const error = new Error('occupied');
      error.response = { status: 409, data: { code: 'SLOT_UNAVAILABLE' } };
      throw error;
    },
  });
  assert.deepEqual(await conflictClient.createBooking(input), {
    status: 'slot_unavailable',
    httpStatus: 409,
    code: 'SLOT_UNAVAILABLE',
  });
});

test('Calendar klient rozpozná produkčný data obal úspešnej rezervácie', async () => {
  const client = new PrixiCalendarServiceClient({
    post: async () => ({
      status: 201,
      data: { data: { id: 'booking-789', start_at: '2026-11-16T09:00:00+01:00' } },
    }),
  });
  const result = await client.createBooking({
    clinicId: 168,
    calendarId: 7,
    eventTypeUid: 'preventive-exam',
    startAt: '2026-11-16T09:00:00+01:00',
    patient: { name: 'Ján', surname: 'Novák', phone_number: '+421900000000' },
    metadata: { source: 'voice_bot', externalReference: 'CA123' },
    idempotencyKey: 'same-key',
  });
  assert.deepEqual(result, {
    status: 'created',
    bookingId: 'booking-789',
    startAt: '2026-11-16T09:00:00+01:00',
    endAt: undefined,
  });
});

