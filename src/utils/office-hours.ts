import { DateTime } from 'luxon';

export interface OfficeHoursConfig {
  [dayOfWeek: string]: {
    start: string; // HH:mm format, e.g. "09:00"
    end: string;   // HH:mm format, e.g. "17:00"
  } | null;
}

/**
 * Checks if the current time is within the provided office hours for a given timezone.
 */
export function isWithinOfficeHours(officeHours: OfficeHoursConfig, timezone: string): boolean {
  if (!officeHours || !timezone) {
    return false; // Default to outside office hours if config is missing
  }

  // Get current time in the clinic's timezone
  const now = DateTime.now().setZone(timezone);
  
  if (!now.isValid) {
    throw new Error(`Invalid timezone provided: ${timezone}`);
  }

  // Get current day of week (1 = Monday, 7 = Sunday). luxon uses 1-7.
  // Map to lowercase day names to match simple JSON config convention
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const currentDayName = dayNames[now.weekday - 1];

  const todayHours = officeHours[currentDayName];

  if (!todayHours) {
    return false; // Not open today
  }

  const [startHour, startMinute] = todayHours.start.split(':').map(Number);
  const [endHour, endMinute] = todayHours.end.split(':').map(Number);

  const startTime = now.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
  const endTime = now.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });

  return now >= startTime && now <= endTime;
}
