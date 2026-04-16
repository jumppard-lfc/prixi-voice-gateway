const DEFAULT_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

const processedEvents = new Map<string, number>();
const inFlightEvents = new Set<string>();

function pruneExpiredEvents(now = Date.now()): void {
  for (const [key, expiresAt] of processedEvents.entries()) {
    if (expiresAt <= now) {
      processedEvents.delete(key);
    }
  }
}

export function createVoiceEventKey(eventName: string, providerCallId: string): string {
  return `${eventName}:${providerCallId}`;
}

export function claimVoiceEvent(eventKey: string): boolean {
  pruneExpiredEvents();

  if (processedEvents.has(eventKey) || inFlightEvents.has(eventKey)) {
    return false;
  }

  inFlightEvents.add(eventKey);
  return true;
}

export function completeVoiceEvent(eventKey: string): void {
  inFlightEvents.delete(eventKey);
  processedEvents.set(eventKey, Date.now() + DEFAULT_EVENT_TTL_MS);
}

export function failVoiceEvent(eventKey: string): void {
  inFlightEvents.delete(eventKey);
}