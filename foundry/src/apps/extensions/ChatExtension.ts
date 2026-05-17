import { AiService } from '../../services/AiService.js';
import type {
  AiGmExtension,
  ExtensionButton,
  OutputSection,
  SharedContext,
  TabContext,
} from '../AiGmExtension.js';

type ChatPhase = 'idle' | 'asking' | 'asked';

export class ChatExtension implements AiGmExtension {
  readonly id = 'chat';
  readonly tabLabel = 'Chat';

  private _inputText = '';
  private _phase: ChatPhase = 'idle';
  private _response = '';
  private _abortController: AbortController | null = null;
  private _tabEl: HTMLElement | null = null;

  prepareContext(shared: SharedContext): TabContext {
    const canSend = shared.loreIndexExists ? !!shared.selectedScene : true;
    const sections: OutputSection[] =
      this._phase !== 'idle' ? [{ id: 'response', content: this._response }] : [];

    const buttons: ExtensionButton[] = [
      { id: 'send', label: 'Send', icon: 'fa-paper-plane', disabled: !canSend },
    ];
    if (this._phase === 'asking') {
      buttons.push({ id: 'stop', label: 'Stop', icon: 'fa-stop' });
    }

    return {
      inputText: this._inputText,
      inputPlaceholder: 'Ask a question about the selected scene…',
      sections,
      buttons,
      isLoading: this._phase === 'asking',
    };
  }

  onRender(tabEl: HTMLElement, _requestRender: () => Promise<void>): void {
    this._tabEl = tabEl;
    tabEl.querySelector<HTMLTextAreaElement>('textarea')?.addEventListener('input', (e) => {
      this._inputText = (e.target as HTMLTextAreaElement).value;
    });
  }

  async onButton(
    buttonId: string,
    shared: SharedContext,
    requestRender: () => Promise<void>,
  ): Promise<void> {
    if (buttonId === 'send') return this._send(shared, requestRender);
    if (buttonId === 'stop') this._abortController?.abort();
  }

  async onUse(
    _sectionId: string,
    _shared: SharedContext,
    _requestRender: () => Promise<void>,
  ): Promise<void> {}

  private async _send(shared: SharedContext, requestRender: () => Promise<void>): Promise<void> {
    if (!this._inputText.trim()) return;
    if (shared.loreIndexExists && !shared.selectedScene) return;

    this._phase = 'asking';
    this._response = '';
    this._abortController = new AbortController();
    await requestRender();

    const systemPrompt = shared.sceneContext
      ? "You are a TTRPG GM assistant. Answer the GM's question concisely and accurately using only the provided adventure lore context."
      : "You are a TTRPG GM assistant. Answer the GM's question concisely and accurately.";
    const userPrompt = shared.sceneContext
      ? `${shared.sceneContext}\n\n---\n\n${this._inputText.trim()}`
      : this._inputText.trim();

    try {
      await AiService.create(game as unknown as any).stream(
        systemPrompt,
        userPrompt,
        (chunk, type) => {
          if (type !== 'content') return;
          this._response += chunk;
          const el = this._tabEl?.querySelector(
            '[data-section-id="response"] .beavers-ai-section-content',
          );
          if (el) el.textContent = this._response;
        },
        { max_tokens: 1024, signal: this._abortController.signal },
      );
      this._phase = 'asked';
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        ui.notifications.error(`Question failed: ${(err as Error).message}`);
      }
      this._phase = 'idle';
    } finally {
      this._abortController = null;
    }

    await requestRender();
  }
}
