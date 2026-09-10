/**
 * Accept a birth year only when the transcript contains nothing except four
 * dictated digits (with optional spaces, hyphens and trailing punctuation).
 * This deliberately rejects prose, URLs and other hallucinated content.
 */
export function normalizeBirthYearTranscript(
  transcript: string,
  currentYear: number = new Date().getFullYear()
): string {
  const candidate = transcript
    .trim()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/[\s-]+/g, '');

  if (!/^\d{4}$/.test(candidate)) return '';

  const year = Number(candidate);
  return year >= 1900 && year <= currentYear ? candidate : '';
}
