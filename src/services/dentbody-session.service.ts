export interface DentbodySession {
  callSid: string;
  phone: string;
  clinicId: string;
  answeredQuestions: number;
  failedAttempts: number;
  awaitingFollowUp: boolean;
  startedAt: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class DentbodySessionService {
  private sessions = new Map<string, DentbodySession>();

  create(callSid: string, phone: string, clinicId: string): DentbodySession {
    const session: DentbodySession = {
      callSid,
      phone,
      clinicId,
      answeredQuestions: 0,
      failedAttempts: 0,
      awaitingFollowUp: false,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): DentbodySession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: DentbodySession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const dentbodySessionService = new DentbodySessionService();
