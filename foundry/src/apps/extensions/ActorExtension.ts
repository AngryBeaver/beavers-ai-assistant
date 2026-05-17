import { MODULE_FOLDER_NAME, ACTORS_FOLDER_NAME } from '../../definitions.js';
import { AiService } from '../../services/AiService.js';
import { JournalApi } from '../../api/JournalApi.js';
import type {
  AiGmExtension,
  ExtensionButton,
  OutputSection,
  SharedContext,
  TabContext,
} from '../AiGmExtension.js';

interface ActorProfile {
  name: string;
  personality: string;
  background: string;
  traits: string;
  ticks: string;
  manners: string;
  catchphrase: string;
  speech: string;
}

type ActorPhase = 'idle' | 'asking' | 'options';

export class ActorExtension implements AiGmExtension {
  readonly id = 'actor';
  readonly tabLabel = 'Actor';

  private _inputText = '';
  private _phase: ActorPhase = 'idle';
  private _profiles: ActorProfile[] = [];
  private _abortController: AbortController | null = null;

  prepareContext(shared: SharedContext): TabContext {
    const canGenerate = shared.loreIndexExists && !!shared.selectedScene;

    const sections: OutputSection[] =
      this._phase === 'options'
        ? this._profiles.map((p, i) => ({
            id: String(i),
            title: p.name,
            content: this._formatProfile(p),
            useButtonLabel: 'Save as Actor',
          }))
        : [];

    const buttons: ExtensionButton[] = [
      { id: 'generate', label: 'Create Actor', icon: 'fa-user-pen', disabled: !canGenerate },
    ];
    if (this._phase === 'asking') {
      buttons.push({ id: 'stop', label: 'Stop', icon: 'fa-stop' });
    }

    return {
      inputText: this._inputText,
      inputPlaceholder: 'Describe the NPC — appearance, role, mannerisms…',
      sections,
      buttons,
      isLoading: this._phase === 'asking',
    };
  }

  onRender(tabEl: HTMLElement, _requestRender: () => Promise<void>): void {
    tabEl.querySelector<HTMLTextAreaElement>('textarea')?.addEventListener('input', (e) => {
      this._inputText = (e.target as HTMLTextAreaElement).value;
    });
  }

  async onButton(
    buttonId: string,
    shared: SharedContext,
    requestRender: () => Promise<void>,
  ): Promise<void> {
    if (buttonId === 'generate') return this._generate(shared, requestRender);
    if (buttonId === 'stop') this._abortController?.abort();
  }

  async onUse(
    sectionId: string,
    shared: SharedContext,
    requestRender: () => Promise<void>,
  ): Promise<void> {
    const idx = parseInt(sectionId, 10);
    const profile = this._profiles[idx];
    if (!profile) {
      ui.notifications.warn('Actor profile not found.');
      return;
    }
    try {
      const modFolder = await JournalApi.ensureFolder(MODULE_FOLDER_NAME, null);
      const actorsFolder = await JournalApi.ensureFolder(
        ACTORS_FOLDER_NAME,
        modFolder.id as string,
      );

      // Find or create a journal named after the actor
      let actorJournal =
        (game.journal as any)?.find(
          (j: any) => j.folder?.id === actorsFolder.id && j.name === profile.name,
        ) ?? null;
      if (!actorJournal) {
        // @ts-ignore
        actorJournal = await JournalEntry.create({
          name: profile.name,
          folder: actorsFolder.id,
        });
      }

      const result = await JournalApi.writeJournalPage(actorJournal.id as string, {
        name: profile.name,
        text: this._toMarkdown(profile, shared.selectedChapter, shared.selectedScene),
        format: 'markdown',
      });

      ui.notifications.info(`Actor "${profile.name}" saved.`);
      this._phase = 'idle';
      this._profiles = [];
      await requestRender();

      // Open the actor journal to the saved page
      const pageId: string | undefined = Array.isArray(result)
        ? (result[0]?.id as string | undefined)
        : (result?.id as string | undefined);
      (actorJournal as any).sheet?.render(true, pageId ? { pageId } : {});
    } catch (err) {
      ui.notifications.error(`Failed to save actor: ${(err as Error).message}`);
      console.error('[ActorExtension] save failed', err);
    }
  }

  private async _generate(
    shared: SharedContext,
    requestRender: () => Promise<void>,
  ): Promise<void> {
    if (!this._inputText.trim() || !shared.selectedScene) return;

    this._phase = 'asking';
    this._profiles = [];
    this._abortController = new AbortController();
    await requestRender();

    const systemPrompt =
      'You are a TTRPG character designer. Given a GM description of an NPC or character ' +
      '(and optional adventure context), generate exactly 3 distinct character profile variations. ' +
      'Return ONLY a valid JSON array — no markdown, no code fences, no extra text. ' +
      'Each element must be an object with these exact string keys: ' +
      '"name", "personality", "background", "traits", "ticks", "manners", "catchphrase", "speech".';

    const userPrompt = shared.sceneContext
      ? `${shared.sceneContext}\n\n---\n\n${this._inputText.trim()}`
      : this._inputText.trim();

    let fullResponse = '';
    try {
      await AiService.create(game as unknown as any).stream(
        systemPrompt,
        userPrompt,
        (chunk, type) => {
          if (type !== 'content') return;
          fullResponse += chunk;
        },
        { max_tokens: 2048, signal: this._abortController.signal },
      );
      const cleaned = fullResponse
        .replace(/^```(?:json)?\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();
      const parsed = JSON.parse(cleaned) as ActorProfile[];
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid response format');
      this._profiles = parsed.slice(0, 3);
      this._phase = 'options';
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        ui.notifications.error(`Actor generation failed: ${(err as Error).message}`);
      }
      this._phase = 'idle';
    } finally {
      this._abortController = null;
    }

    await requestRender();
  }

  private _formatProfile(p: ActorProfile): string {
    return [
      `Personality: ${p.personality}`,
      `Background: ${p.background}`,
      `Traits: ${p.traits}`,
      `Ticks: ${p.ticks}`,
      `Manners: ${p.manners}`,
      ...(p.catchphrase ? [`Catchphrase: "${p.catchphrase}"`] : []),
      `Speech: ${p.speech}`,
    ].join('\n');
  }

  private _toMarkdown(p: ActorProfile, chapter: string, scene: string): string {
    const lines = [
      `# ${p.name}`,
      '',
      '## Location',
      `**Chapter:** ${chapter}`,
      `**Scene:** ${scene}`,
      '',
      '## Personality',
      p.personality,
      '',
      '## Background',
      p.background,
      '',
      '## Traits',
      p.traits,
      '',
      '## Ticks & Mannerisms',
      p.ticks,
      '',
      '## Manners',
      p.manners,
    ];
    if (p.catchphrase) {
      lines.push('', '## Catchphrase', `*"${p.catchphrase}"*`);
    }
    lines.push('', '## Speech Style', p.speech, '', '## Interactions', '');
    return lines.join('\n');
  }
}
