import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm'
]);

export function getAudioFileExtension(audioUrl: string): string {
  try {
    const extension = path.extname(new URL(audioUrl).pathname).toLowerCase();
    if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) return extension;
  } catch {
    // Fall through to the Twilio format requested by the voicemail flow.
  }

  return '.mp3';
}

export class SttService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Downloads an audio file from a given URL and transcribes it using OpenAI.
   * Cleans up the temporary file after processing.
  */
  async transcribeAudioUrl(audioUrl: string, prompt?: string): Promise<string> {
    // Preserve the real media extension. Twilio serves MP3 bytes when `.mp3`
    // is appended to RecordingUrl; labelling those bytes as WAV makes stricter
    // transcription models reject an otherwise supported file.
    const tempFilePath = path.join(os.tmpdir(), `${uuidv4()}${getAudioFileExtension(audioUrl)}`);
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

    try {
      // 1. Fetch binary audio
      const response = await axios({
        method: 'get',
        url: audioUrl,
        responseType: 'stream',
        auth: twilioAccountSid && twilioAuthToken ? {
          username: twilioAccountSid,
          password: twilioAuthToken,
        } : undefined,
      });

      // 2. Write to /tmp
      const writer = fs.createWriteStream(tempFilePath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 3. Send to the transcription API. The env override provides a quick
      // rollback path without requiring another deployment.
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-transcribe',
        prompt: prompt || 'Telefonická hlasová správa pacienta pre ambulanciu PriXi v slovenčine.',
      });

      return transcription.text;
    } catch (error) {
      console.error('Error during STT processing:', error);
      throw error;
    } finally {
      // 4. Clean up /tmp
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }
}

export const sttService = new SttService();
