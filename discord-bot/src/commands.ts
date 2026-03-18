export interface Command {
  type: 'start' | 'pause' | 'page';
  /** Only set for 'page' commands — the new page name extracted from the transcript. */
  pageName?: string;
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\wäöüß\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect a bot voice command in a Whisper transcript.
 * Returns null if the transcript contains no recognized command.
 *
 * Matching is fuzzy: normalized (lowercase, no punctuation) includes-check so
 * Whisper capitalization and minor punctuation differences don't matter.
 * For the page command the remainder is extracted from the original transcript
 * to preserve proper casing.
 */
export function detectCommand(transcript: string): Command | null {
  const botName = (process.env.BOT_NAME ?? '').trim();
  const startCmd = (process.env.BOT_COMMAND_START ?? '').trim();
  const pauseCmd = (process.env.BOT_COMMAND_PAUSE ?? '').trim();
  const pageCmd = (process.env.BOT_COMMAND_PAGE ?? '').trim();

  if (!botName) return null;

  const norm = normalize(transcript);

  // Bail early if the bot name is not in the transcript at all
  if (!norm.includes(normalize(botName))) return null;

  if (startCmd && norm.includes(normalize(`${botName} ${startCmd}`))) {
    return { type: 'start' };
  }

  if (pauseCmd && norm.includes(normalize(`${botName} ${pauseCmd}`))) {
    return { type: 'pause' };
  }

  if (pageCmd && norm.includes(normalize(`${botName} ${pageCmd}`))) {
    // Extract page name from original transcript to preserve casing
    const regex = new RegExp(`${escapeRegex(botName)}\\W+${escapeRegex(pageCmd)}\\W+(.+)`, 'i');
    const match = transcript.match(regex);
    return { type: 'page', pageName: match?.[1]?.trim() };
  }

  return null;
}
