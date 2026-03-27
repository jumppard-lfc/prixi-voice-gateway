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

    try {
      // 1. Fetch binary audio
      // Note: Twilio recording URLs usually require HTTP Basic Auth with Account SID & Auth Token if secured,
      // but assuming public/signed URLs for simplicity unless specified otherwise.
      const response = await axios({
        method: 'get',
        url: audioUrl,
        responseType: 'stream',
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
