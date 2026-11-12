import { randomUUID } from 'node:crypto';

interface CachedAudio {
  audio: Buffer;
  expiresAt: number;
}

const DYNAMIC_AUDIO_TTL_MS = 10 * 60 * 1000;
const MAX_DYNAMIC_AUDIO_ITEMS = 200;

export class NimalaDynamicAudioService {
  private readonly cache = new Map<string, CachedAudio>();

  put(audio: Buffer): string {
    this.prune();
    while (this.cache.size >= MAX_DYNAMIC_AUDIO_ITEMS) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
    const token = randomUUID();
    this.cache.set(token, { audio, expiresAt: Date.now() + DYNAMIC_AUDIO_TTL_MS });
    return token;
  }

  get(token: string): Buffer | undefined {
    const item = this.cache.get(token);
    if (!item) return undefined;
    if (item.expiresAt <= Date.now()) {
      this.cache.delete(token);
      return undefined;
    }
    return item.audio;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, item] of this.cache) {
      if (item.expiresAt <= now) this.cache.delete(token);
    }
  }
}

export const nimalaDynamicAudioService = new NimalaDynamicAudioService();
