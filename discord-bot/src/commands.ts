export interface Command {
  type: 'start' | 'pause';
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\wäöüß\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect a bot voice command in a Whisper transcript.
 * Returns null if the transcript contains no recognized command.
 *
 * Matching is fuzzy: normalized (lowercase, no punctuation) includes-check so
 * Whisper capitalization and minor punctuation differences don't matter.
 */
export function detectCommand(transcript: string): Command | null {
  const botName = (process.env.BOT_NAME ?? '').trim();
  const startCmd = (process.env.BOT_COMMAND_START ?? '').trim();
  const pauseCmd = (process.env.BOT_COMMAND_PAUSE ?? '').trim();

  if (!botName) return null;

  const norm = normalize(transcript);

  if (!norm.includes(normalize(botName))) return null;

  if (startCmd && norm.includes(normalize(`${botName} ${startCmd}`))) {
    return { type: 'start' };
  }

  if (pauseCmd && norm.includes(normalize(`${botName} ${pauseCmd}`))) {
    return { type: 'pause' };
  }

  return null;
}
