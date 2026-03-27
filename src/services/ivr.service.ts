import { DateTime } from 'luxon';
import { ClinicConfig } from '../types';

export class IvrService {
  /**
   * Determines if the current time falls within the configured office hours 
   * for the given timezone.
   */
  isDuringOfficeHours(config: ClinicConfig): boolean {
    if (!config.officeHours) return false;

    // Get current time in the clinic's timezone
    const now = DateTime.now().setZone(config.timezone);
    
    // Fallback if timezone is invalid
    if (!now.isValid) {
      console.warn(`Invalid timezone provided: ${config.timezone}. Falling back to false.`);
      return false;
    }

    // dayOfWeek is 1-7, mapping to Monday-Sunday in Luxon
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
    const currentDayName = dayNames[now.weekday - 1];
    
    const todayHours = config.officeHours[currentDayName];

    if (!todayHours || !todayHours.from || !todayHours.to) {
      return false;
    }

    try {
      // Parse 'HH:mm' format
      const [fromHours, fromMinutes] = todayHours.from.split(':').map(Number);
      const [toHours, toMinutes] = todayHours.to.split(':').map(Number);

      const fromTime = now.set({ hour: fromHours, minute: fromMinutes, second: 0, millisecond: 0 });
      const toTime = now.set({ hour: toHours, minute: toMinutes, second: 0, millisecond: 0 });

      return now >= fromTime && now <= toTime;
    } catch (error) {
       console.error(`Failed to parse office hours for day ${currentDayName}:`, error);
       return false;
    }
  }

  /**
   * Evaluates if the call should be allowed to go to the IVR prompt based on config.
   */
  shouldAllowCall(config: ClinicConfig): boolean {
    return config.voiceBotEnabled === true;
  }
}

export const ivrService = new IvrService();
