import FormData from 'form-data';

const WHISPER_URL = process.env.WHISPER_URL ?? 'http://localhost:9000';
const WHISPER_TASK = process.env.WHISPER_TASK ?? 'transcribe';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? '';

export async function transcribe(wavBuffer: Buffer): Promise<string> {
  // node-fetch v3 is ESM-only — must use dynamic import in a CommonJS module
  const { default: fetch } = await import('node-fetch');

  const form = new FormData();
  form.append('audio_file', wavBuffer, {
    filename: 'audio.wav',
    contentType: 'audio/wav',
  });

  const params = new URLSearchParams({ task: WHISPER_TASK, output: 'txt' });
  if (WHISPER_LANGUAGE) params.set('language', WHISPER_LANGUAGE);

  const url = `${WHISPER_URL}/asr?${params}`;
  const response = await fetch(url, { method: 'POST', body: form });

  if (!response.ok) {
    throw new Error(`Whisper error ${response.status}: ${await response.text()}`);
  }

  return (await response.text()).trim();
}