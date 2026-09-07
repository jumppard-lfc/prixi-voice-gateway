import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VoiceBotConfig, validateVoiceBotConfig } from './voice-bot-framework.service';

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
}

export const voiceBotConfigStore = new VoiceBotConfigStore();
