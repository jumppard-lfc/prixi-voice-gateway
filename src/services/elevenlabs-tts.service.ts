import axios, { AxiosInstance } from 'axios';

export interface ElevenLabsPhoneVoiceConfig {
  voiceId: string;
  modelId: string;
  languageCode: string;
  applyTextNormalization: 'auto' | 'on' | 'off';
  outputFormat: string;
  voiceSettings: {
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    speed: number;
  };
}

export class ElevenLabsTtsService {
  private readonly client: AxiosInstance;

  constructor(client?: AxiosInstance) {
    this.client = client || axios.create({
      baseURL: 'https://api.elevenlabs.io',
      timeout: 8_000,
    });
  }

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  }

  async synthesizeForPhone(text: string, config: ElevenLabsPhoneVoiceConfig): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) throw new Error('ElevenLabs TTS is not configured');

    const response = await this.client.post(
      `/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream`,
      {
        text,
        model_id: config.modelId,
        language_code: config.languageCode,
        apply_text_normalization: config.applyTextNormalization,
        voice_settings: {
          stability: config.voiceSettings.stability,
          similarity_boost: config.voiceSettings.similarityBoost,
          style: config.voiceSettings.style,
          use_speaker_boost: config.voiceSettings.useSpeakerBoost,
          speed: config.voiceSettings.speed,
        },
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/ulaw',
        },
        params: { output_format: config.outputFormat },
        responseType: 'arraybuffer',
      }
    );

    const audio = Buffer.from(response.data);
    if (!audio.length) throw new Error('ElevenLabs returned empty audio');
    return audio;
  }
}

export const elevenLabsTtsService = new ElevenLabsTtsService();
