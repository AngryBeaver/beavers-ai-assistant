const WHISPER_URL = process.env.WHISPER_URL ?? 'http://localhost:9000';
const WHISPER_TASK = process.env.WHISPER_TASK ?? 'transcribe';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? '';
const WHISPER_INITIAL_PROMPT = process.env.WHISPER_INITIAL_PROMPT ?? '';
const WHISPER_TIMEOUT_MS = parseInt(process.env.WHISPER_TIMEOUT_MS ?? '30000', 10);

export async function transcribe(wavBuffer: Buffer): Promise<string> {
  const form = new FormData();
  form.append('audio_file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');

  const params = new URLSearchParams({ task: WHISPER_TASK, output: 'txt' });
  if (WHISPER_LANGUAGE) params.set('language', WHISPER_LANGUAGE);
  if (WHISPER_INITIAL_PROMPT) params.set('initial_prompt', WHISPER_INITIAL_PROMPT);

  const url = `${WHISPER_URL}/asr?${params}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), WHISPER_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: abort.signal });

    if (!response.ok) {
      throw new Error(`Whisper error ${response.status}: ${await response.text()}`);
    }

    return (await response.text()).trim();
  } finally {
    clearTimeout(timer);
  }
}
