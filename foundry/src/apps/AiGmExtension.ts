export interface OutputSection {
  id: string;
  title?: string;
  content: string;
  useButtonLabel?: string;
}

export interface ExtensionButton {
  id: string;
  label: string;
  icon: string;
  disabled?: boolean;
}

export interface TabContext {
  inputText: string;
  inputPlaceholder: string;
  sections: OutputSection[];
  buttons: ExtensionButton[];
  isLoading: boolean;
}

export interface ContextFlags {
  scene: boolean;
  locationScene: boolean;
  overview: boolean;
  actor: boolean;
  session: boolean;
}

export interface SharedContext {
  loreIndexExists: boolean;
  selectedChapter: string;
  selectedScene: string;
  /** Foundry document ID of the active chapter journal, or null if unavailable. */
  chapterJournalId: string | null;
  contextFlags: ContextFlags;
  /** Pre-built lore context string from checked flags; null when nothing is enabled/found. */
  sceneContext: string | null;
}

export interface AiGmExtension {
  readonly id: string;
  readonly tabLabel: string;

  prepareContext(shared: SharedContext): TabContext;

  /** Called after each render with the tab's root element. Wire up input listeners here. */
  onRender(tabEl: HTMLElement, requestRender: () => Promise<void>): void;

  /** Called when a bottom-row button is clicked. */
  onButton(
    buttonId: string,
    shared: SharedContext,
    requestRender: () => Promise<void>,
  ): Promise<void>;

  /** Called when a section's Use button is clicked. */
  onUse(
    sectionId: string,
    shared: SharedContext,
    requestRender: () => Promise<void>,
  ): Promise<void>;
}
