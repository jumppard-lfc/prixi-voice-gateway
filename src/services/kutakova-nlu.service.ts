import { KutakovaHealthInsurer } from '../config/kutakova.config';
import { normalizeNeurocentrumSpeech } from './neurocentrum-nlu.service';

export function parseKutakovaHealthInsurer(value: string): KutakovaHealthInsurer | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  if (text === '1' || /vseobecn|vszp/.test(text)) return 'Všeobecná zdravotná poisťovňa';
  if (text === '2' || /dovera/.test(text)) return 'Dôvera';
  if (text === '3' || /union/.test(text)) return 'Union';
  if (text === '4' || /ina|ine|neviem|neuved/.test(text)) return 'Iná alebo neuvedená';
  return undefined;
}
