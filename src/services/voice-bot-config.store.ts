import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeTwilioNumber, VoiceBotConfig, validateVoiceBotConfig } from './voice-bot-framework.service';

/**
 * The source-of-truth for live demo bot configurations.
 *
 * This directory is committed to Git, so Render receives the same configs on
 * every deploy. It deliberately does not default to an application-writable
 * data directory: Render's service filesystem is ephemeral.
 */
function repositoryConfigDirectory(): string {
  return process.env.VOICE_BOT_CONFIG_REPOSITORY_DIR || resolve(process.cwd(), 'configs', 'demo-voice-bots');
}

/**
 * An explicit writable directory is useful for local development and tests,
 * but is never the production source of truth. Runtime configs override a
 * committed config with the same id, which makes local iteration convenient.
 */
function runtimeConfigDirectory(): string | undefined {
  return process.env.VOICE_BOT_CONFIG_DIR;
}

function configPath(directory: string, id: string): string {
  return resolve(directory, `${id}.json`);
}

function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(id);
}

export class VoiceBotConfigStore {
  async save(config: VoiceBotConfig): Promise<VoiceBotConfig> {
    const validation = validateVoiceBotConfig(config);
    if (!validation.valid) throw new Error(validation.errors.join(' '));

    const directory = runtimeConfigDirectory();
    if (!directory) {
      throw new Error('Ukladanie priamo na server nie je zapnuté. Stiahnite JSON a uložte ho do configs/demo-voice-bots v Git repozitári.');
    }

    const requestedNumbers = new Set((config.routing?.inboundTwilioNumbers || []).map(normalizeTwilioNumber));
    if (requestedNumbers.size > 0) {
      const conflictingConfig = (await this.list()).find((saved) => saved.id !== config.id
        && (saved.routing?.inboundTwilioNumbers || []).some((number) => requestedNumbers.has(normalizeTwilioNumber(number))));
      if (conflictingConfig) {
        throw new Error(`Twilio číslo je už priradené botovi „${conflictingConfig.id}“.`);
      }
    }

    await mkdir(directory, { recursive: true });
    const target = configPath(directory, config.id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
    return config;
  }

  async get(id: string): Promise<VoiceBotConfig | undefined> {
    if (!isSafeId(id)) return undefined;
    const runtimeDirectory = runtimeConfigDirectory();
    const directories = [repositoryConfigDirectory(), ...(runtimeDirectory ? [runtimeDirectory] : [])];

    for (const directory of directories.reverse()) {
      const config = await this.readConfig(directory, id);
      if (config) return config;
    }
    return undefined;
  }

  async list(): Promise<VoiceBotConfig[]> {
    const configs = new Map<string, VoiceBotConfig>();
    const directories = [repositoryConfigDirectory(), ...(runtimeConfigDirectory() ? [runtimeConfigDirectory()!] : [])];

    for (const directory of directories) {
      try {
        const files = await readdir(directory, { withFileTypes: true });
        const loaded = await Promise.all(files
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => this.readConfig(directory, entry.name.slice(0, -'.json'.length))));
        for (const config of loaded) {
          if (config) configs.set(config.id, config);
        }
      } catch {
        // An empty repository directory is a valid initial state.
      }
    }

    return [...configs.values()];
  }

  async findByInboundTwilioNumber(number: string | undefined): Promise<VoiceBotConfig | undefined> {
    if (!number) return undefined;
    const normalizedNumber = normalizeTwilioNumber(number);
    return (await this.list()).find((config) => (config.routing?.inboundTwilioNumbers || [])
      .some((configuredNumber) => normalizeTwilioNumber(configuredNumber) === normalizedNumber));
  }

  private async readConfig(directory: string, id: string): Promise<VoiceBotConfig | undefined> {
    try {
      const raw = await readFile(configPath(directory, id), 'utf8');
      const config = JSON.parse(raw) as VoiceBotConfig;
      return validateVoiceBotConfig(config).valid ? config : undefined;
    } catch {
      return undefined;
    }
  }
}

export const voiceBotConfigStore = new VoiceBotConfigStore();
