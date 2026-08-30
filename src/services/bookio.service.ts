import { BookingServiceCode, OfferedSlot } from '../types';

export interface CreateBookioBookingInput {
  service: BookingServiceCode;
  slotId: string;
  firstName: string;
  lastName: string;
  phone: string;
  note: string;
  acceptedTerms: true;
  marketingConsent: boolean;
}

const serviceNames: Record<BookingServiceCode, string> = {
  initial_exam: 'Vstupné očné vyšetrenie', follow_up: 'Kontrola', acute_exam: 'Akútne vyšetrenie',
  certificate_exam: 'Vyšetrenie na vodičský/zbrojný preukaz/výškové práce', aesthetic_medicine: 'Estetická medicína'
};

export class BookioService {
  // This mock is intentional: public Bookio pages do not provide the clinic's authenticated API contract.
  // Replace only these two methods after Bookio supplies the endpoint and credentials.
  async getAvailableSlots(service: BookingServiceCode, preference: { timeOfDay?: 'morning' | 'afternoon' }): Promise<OfferedSlot[]> {
    const base = new Date(); base.setDate(base.getDate() + 1); base.setHours(preference.timeOfDay === 'afternoon' ? 14 : 9, 40, 0, 0);
    return [0, 1, 2].map((offset) => {
      const start = new Date(base); start.setDate(base.getDate() + offset * 2);
      return { id: `mock-${service}-${start.toISOString()}`, startAt: start.toISOString(), serviceName: serviceNames[service] };
    });
  }

  async createBooking(input: CreateBookioBookingInput): Promise<{ bookingId: string }> {
    if (process.env.BOOKIO_MOCK_MODE !== 'true') {
      throw new Error('Bookio live API is not configured. Set BOOKIO_MOCK_MODE=true for the demo or configure the authenticated Bookio adapter.');
    }
    return { bookingId: `mock-bookio-${Date.now()}` };
  }
}

export const bookioService = new BookioService();
