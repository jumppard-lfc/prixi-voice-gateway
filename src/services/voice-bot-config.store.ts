import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeTwilioNumber, VoiceBotConfig, validateVoiceBotConfig } from './voice-bot-framework.service';

function configDirectory(): string {
  return process.env.VOICE_BOT_CONFIG_DIR || resolve(process.cwd(), 'data', 'voice-bot-configs');
}

function configPath(id: string): string {
  return resolve(configDirectory(), `${id}.json`);
}

function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(id);
}

export class VoiceBotConfigStore {
  async save(config: VoiceBotConfig): Promise<VoiceBotConfig> {
    const validation = validateVoiceBotConfig(config);
    if (!validation.valid) throw new Error(validation.errors.join(' '));

    const requestedNumbers = new Set((config.routing?.inboundTwilioNumbers || []).map(normalizeTwilioNumber));
    if (requestedNumbers.size > 0) {
      const conflictingConfig = (await this.list()).find((saved) => saved.id !== config.id
        && (saved.routing?.inboundTwilioNumbers || []).some((number) => requestedNumbers.has(normalizeTwilioNumber(number))));
      if (conflictingConfig) {
        throw new Error(`Twilio číslo je už priradené botovi „${conflictingConfig.id}“.`);
      }
    }

    const directory = configDirectory();
    await mkdir(directory, { recursive: true });
    const target = configPath(config.id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
    return config;
  }

  async get(id: string): Promise<VoiceBotConfig | undefined> {
    if (!isSafeId(id)) return undefined;
    try {
      const raw = await readFile(configPath(id), 'utf8');
      const config = JSON.parse(raw) as VoiceBotConfig;
      return validateVoiceBotConfig(config).valid ? config : undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<VoiceBotConfig[]> {
    try {
      const files = await readdir(configDirectory(), { withFileTypes: true });
      const configs = await Promise.all(files
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => this.get(entry.name.slice(0, -'.json'.length))));
      return configs.filter((config): config is VoiceBotConfig => Boolean(config));
    } catch {
      return [];
    }
  }

  async findByInboundTwilioNumber(number: string | undefined): Promise<VoiceBotConfig | undefined> {
    if (!number) return undefined;
    const normalizedNumber = normalizeTwilioNumber(number);
    return (await this.list()).find((config) => (config.routing?.inboundTwilioNumbers || [])
      .some((configuredNumber) => normalizeTwilioNumber(configuredNumber) === normalizedNumber));
  }
}

export const voiceBotConfigStore = new VoiceBotConfigStore();
