import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

export class SttService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Downloads an audio file from a given URL and transcribes it using OpenAI Whisper.
   * Cleans up the temporary file after processing.
   */
  async transcribeAudioUrl(audioUrl: string): Promise<string> {
    const tempFilePath = path.join(os.tmpdir(), `${uuidv4()}.wav`);
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

      // 3. Send to Whisper API
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'sk',
        prompt: 'Hlasová správa pre lekára v ambulancii PriXi. Pacient uvádza svoje meno, priezvisko a dôvod volania, napríklad recept na lieky ako Ibalgin, Paralen, kontrola alebo choroba.',
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
