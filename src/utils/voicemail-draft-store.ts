const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface VoicemailDraft {
  callSid: string;
  fromNumber: string;
  forwardedFrom: string;
  pediatricMode: boolean;
  dentalMode: boolean;
  problemUrl: string;
  problemDuration: string;
  nameUrl: string;
  nameDuration: string;
  birthYearUrl: string;
  birthYearDuration: string;
  callStartedAt: string;
  callEndedAt: string;
  callCompleted: boolean;
  expiresAt: number;
}

const drafts = new Map<string, VoicemailDraft>();

function pruneExpiredDrafts(now = Date.now()): void {
  for (const [callSid, draft] of drafts.entries()) {
    if (draft.expiresAt <= now) drafts.delete(callSid);
  }
}

export function updateVoicemailDraft(
  callSid: string,
  update: Partial<Omit<VoicemailDraft, 'callSid' | 'expiresAt'>>
): VoicemailDraft | undefined {
  if (!callSid) return undefined;

  pruneExpiredDrafts();
  const existing = drafts.get(callSid);
  const draft: VoicemailDraft = {
    callSid,
    fromNumber: '',
    forwardedFrom: '',
    pediatricMode: false,
    dentalMode: false,
    problemUrl: '',
    problemDuration: '0',
    nameUrl: '',
    nameDuration: '0',
    birthYearUrl: '',
    birthYearDuration: '0',
    callStartedAt: new Date().toISOString(),
    callEndedAt: '',
    callCompleted: false,
    ...existing,
    ...update,
    expiresAt: Date.now() + DRAFT_TTL_MS,
  };

  drafts.set(callSid, draft);
  return draft;
}

export function getVoicemailDraft(callSid: string): VoicemailDraft | undefined {
  pruneExpiredDrafts();
  return drafts.get(callSid);
}

