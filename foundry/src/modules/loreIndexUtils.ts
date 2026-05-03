// ---------------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------------

function convertTable(tableInner: string): string {
  const rows: string[][] = [];

  for (const rowMatch of tableInner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(
        cellMatch[1]
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
    if (cells.length) rows.push(cells);
  }

  if (!rows.length) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const pad = (row: string[]) => [...row, ...Array(colCount - row.length).fill('')];

  const lines = [
    '| ' + pad(rows[0]).join(' | ') + ' |',
    '| ' + Array(colCount).fill('---').join(' | ') + ' |',
    ...rows.slice(1).map((r) => '| ' + pad(r).join(' | ') + ' |'),
  ];

  return '\n' + lines.join('\n') + '\n';
}

function convertList(listInner: string, ordered: boolean): string {
  const items: string[] = [];
  let i = 1;
  for (const m of listInner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = m[1]
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) items.push(ordered ? `${i++}. ${text}` : `- ${text}`);
  }
  return items.length ? '\n' + items.join('\n') + '\n' : '';
}

export function pageText(page: any): string {
  return page.text?.format === 2
    ? (page.text?.markdown ?? '')
    : stripHtml(page.text?.content ?? '');
}

export function stripHtml(html: string, h1Level = 3): string {
  const h = (n: number): string => '#'.repeat(Math.min(h1Level + n - 1, 6));
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, t) => `\n${h(1)} ${t}\n`)
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, t) => `\n${h(2)} ${t}\n`)
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, t) => `\n${h(3)} ${t}\n`)
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, (_, t) => `\n${h(4)} ${t}\n`)
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, (_, t) => `\n${h(5)} ${t}\n`)
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, (_, t) => `\n${h(6)} ${t}\n`)
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => convertTable(inner))
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => convertList(inner, true))
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => convertList(inner, false))
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

export function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

/**
 * Fetch an image at any URL and return it as a base64 string with its media type.
 * Works for same-origin Foundry paths (e.g. `modules/...`) and external URLs.
 */
const _VISION_SAFE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

export async function fetchImageAsBase64(
  imageUrl: string,
): Promise<{ base64: string; mediaType: string }> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status}): ${imageUrl}`);
  const buffer = await response.arrayBuffer();

  const contentType = response.headers.get('content-type') ?? '';
  const detectedType = contentType.split(';')[0].trim();
  const mediaType =
    (detectedType.startsWith('image/') ? detectedType : null) ?? _mediaTypeFromUrl(imageUrl);

  // Convert to JPEG if the format isn't supported by typical vision backends (e.g. webp)
  if (!_VISION_SAFE_TYPES.has(mediaType)) {
    const blob = new Blob([buffer], { type: mediaType });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { base64: btoa(binary), mediaType };
}

function _mediaTypeFromUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext] ?? 'image/jpeg';
}

// ---------------------------------------------------------------------------
// Foundry markup cleaner
// ---------------------------------------------------------------------------

/**
 * Remove or simplify Foundry-specific inline markup so the AI sees plain text.
 *
 * Rules applied in order:
 *   @Embed[...]           → removed
 *   @Tag[...]{Label}      → Label
 *   @Tag[...]             → removed (no display text)
 *   &amp;Reference[...]{Label} / &Reference[...]{Label} → Label
 *   [[/check ...]]        → (Skill DC N)
 *   [[/save ...]]         → (Ability save DC N)
 *   [[/...]]              → removed
 */
export function cleanFoundryMarkup(text: string): string {
  return (
    text
      // @Embed[...] — always remove (no useful display text)
      .replace(/@Embed\[[^\]]*\](?:\{[^}]*\})?/g, '')
      // @Tag[...]{Label} — keep label only
      .replace(/@\w+(?:\.\w+)*\[[^\]]*\]\{([^}]*)\}/g, '$1')
      // @Tag[...] with no label — remove
      .replace(/@\w+(?:\.\w+)*\[[^\]]*\]/g, '')
      // @Compendium.dotted.path{Label} — keep label only
      .replace(/@[\w.]+\{([^}]*)\}/g, '$1')
      // &amp;Reference[...]{Label} or &Reference[...]{Label} — keep label
      .replace(/&amp;Reference\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/&Reference\[[^\]]*\]\{([^}]*)\}/g, '$1')
      // [[/check skill=X dc=N ...]] → (X DC N)
      .replace(/\[\[\/check\b([^\]]*)\]\]/gi, (_, args) => {
        const skill = args.match(/\bskill=(\S+)/i)?.[1] ?? '';
        const dc = args.match(/\bdc=(\d+)/i)?.[1] ?? '';
        const label = skill
          ? `${skill.charAt(0).toUpperCase()}${skill.slice(1)} DC ${dc}`
          : `DC ${dc}`;
        return `(${label})`;
      })
      // [[/save ability=X dc=N ...]] → (X save DC N)
      .replace(/\[\[\/save\b([^\]]*)\]\]/gi, (_, args) => {
        const ability = args.match(/\bability=(\S+)/i)?.[1] ?? '';
        const dc = args.match(/\bdc=(\d+)/i)?.[1] ?? '';
        const label = ability
          ? `${ability.charAt(0).toUpperCase()}${ability.slice(1)} save DC ${dc}`
          : `save DC ${dc}`;
        return `(${label})`;
      })
      // Any remaining [[/...]] — remove
      .replace(/\[\[\/[^\]]*\]\]/g, '')
      // Collapse extra whitespace left by removals
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// AI output parser
// ---------------------------------------------------------------------------

export interface IndexOutputBlock {
  chapterSummary: string;
  scenes: Map<string, string>;
}

/**
 * Parse sentinel-delimited AI output into a chapter summary and scene map.
 *
 * Expected format (each sentinel on its own line):
 * ```
 * ---CHAPTER: Name---
 * ...chapter summary text...
 * ---SCENE: Scene Name---
 * ...scene detail text...
 * ```
 */
export function parseIndexOutput(raw: string): IndexOutputBlock {
  const scenes = new Map<string, string>();
  let chapterSummary = '';

  type Block = { type: 'CHAPTER' | 'SCENE'; name: string };
  let current: Block | null = null;
  const currentLines: string[] = [];

  const flush = (): void => {
    if (!current) return;
    const content = currentLines.join('\n').trim();
    if (current.type === 'CHAPTER') {
      chapterSummary = content;
    } else {
      scenes.set(current.name, content);
    }
    currentLines.length = 0;
  };

  for (const line of raw.split('\n')) {
    const chm = line.match(/^---CHAPTER:\s*([^-]+?)\s*---\s*$/);
    const scm = line.match(/^---SCENE:\s*([^-]+?)\s*---\s*$/);
    if (chm) {
      flush();
      current = { type: 'CHAPTER', name: chm[1] };
    } else if (scm) {
      flush();
      current = { type: 'SCENE', name: scm[1] };
    } else if (current) {
      currentLines.push(line);
    }
  }
  flush();

  return { chapterSummary, scenes };
}
