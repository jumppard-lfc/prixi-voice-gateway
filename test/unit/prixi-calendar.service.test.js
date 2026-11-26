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

test('Calendar klient zachová bezpečnú diagnostiku validačnej chyby', async () => {
  const client = new PrixiCalendarServiceClient({
    post: async () => {
      const error = new Error('Request failed with status code 422');
      error.response = {
        status: 422,
        data: {
          message: 'The given data was invalid.',
          errors: {
            patient: ['Kontaktné údaje patria pacientovi s iným menom.'],
          },
        },
      };
      throw error;
    },
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
    status: 'validation_error',
    message: 'The given data was invalid.',
    httpStatus: 422,
    code: undefined,
    validationFields: ['patient'],
    validationDetails: ['patient: Kontaktné údaje patria pacientovi s iným menom.'],
  });
});

test('Calendar klient overí pacienta a načíta jeho budúce rezervácie s krátkodobým tokenom', async () => {
  const calls = [];
  const client = new PrixiCalendarServiceClient({
    post: async (path, payload) => {
      calls.push({ method: 'post', path, payload });
      return { data: { success: true, verificationToken: 'verification-token', expiresIn: 600 } };
    },
    get: async (path, options) => {
      calls.push({ method: 'get', path, options });
      return { data: { success: true, bookings: [{
        id: 456,
        clinicId: 168,
        calendarId: 7,
        calendarName: 'MUDr. Dávid Anovčin',
        eventTypeUid: 'preventive-exam',
        startAt: '2026-11-23T09:00:00+01:00',
        endAt: '2026-11-23T09:30:00+01:00',
        durationMinutes: 30,
        status: 'accepted',
      }] } };
    },
  });

  assert.deepEqual(await client.verifyPatient({ clinicId: 168, phone: '+421900000000' }), {
    status: 'verified',
    verificationToken: 'verification-token',
    expiresIn: 600,
  });
  const listed = await client.listPatientBookings(168, 'verification-token');
  assert.equal(listed.status, 'ok');
  assert.equal(listed.bookings[0].id, 456);
  assert.deepEqual(calls[0], {
    method: 'post',
    path: '/api/calendar/patients/verify',
    payload: { clinicId: 168, phone: '+421900000000' },
  });
  assert.equal(calls[1].path, '/api/calendar/bookings');
  assert.equal(calls[1].options.headers['X-Patient-Verification-Token'], 'verification-token');
});

test('Calendar klient presunie a zruší rezerváciu s pacientskym tokenom a idempotency kľúčom', async () => {
  const calls = [];
  const client = new PrixiCalendarServiceClient({
    patch: async (path, payload, options) => {
      calls.push({ method: 'patch', path, payload, options });
      return { data: {
        success: true,
        booking: {
          id: 456,
          clinicId: 168,
          calendarId: 7,
          calendarName: 'MUDr. Dávid Anovčin',
          eventTypeUid: 'preventive-exam',
          startAt: payload.startAt,
          endAt: '2026-11-25T11:00:00+01:00',
          status: 'accepted',
        },
        notification: { email: 'sent' },
      } };
    },
    post: async (path, payload, options) => {
      calls.push({ method: 'post', path, payload, options });
      return { data: { success: true, code: 'CANCELLED' } };
    },
  });
  const shared = {
    bookingId: 456,
    clinicId: 168,
    verificationToken: 'patient-token',
    idempotencyKey: 'same-operation-key',
  };
  const rescheduled = await client.rescheduleBooking({
    ...shared,
    calendarId: 7,
    eventTypeUid: 'preventive-exam',
    startAt: '2026-11-25T10:30:00+01:00',
  });
  assert.equal(rescheduled.status, 'rescheduled');
  assert.equal(rescheduled.emailNotification, 'sent');
  assert.equal(calls[0].path, '/api/calendar/bookings/456/reschedule');
  assert.equal(calls[0].options.headers['X-Patient-Verification-Token'], 'patient-token');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'same-operation-key');

  assert.deepEqual(await client.cancelBooking(shared), { status: 'cancelled' });
  assert.equal(calls[1].path, '/api/calendar/bookings/456/cancel');
  assert.deepEqual(calls[1].payload, { clinicId: 168 });
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'same-operation-key');
});

