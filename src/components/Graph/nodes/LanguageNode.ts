import { ClassicPreset } from 'rete';
import { Observable, Subject, share, filter } from 'rxjs';
import { franc } from 'franc-min';
import i18next from 'i18next';
import { eventSocket } from './types';
import { SelectControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

// Debug flag for development
const DEBUG = false;

// Supported languages for the dropdown (ISO 639-3 codes used by franc)
const LANGUAGES = [
  { value: 'jpn', label: 'Japanese' },
  { value: 'eng', label: 'English' },
  { value: 'cmn', label: 'Chinese' },
  { value: 'kor', label: 'Korean' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'por', label: 'Portuguese' },
  { value: 'rus', label: 'Russian' },
  { value: 'ara', label: 'Arabic' },
];

export class LanguageNode extends ClassicPreset.Node {
  static readonly nodeType = 'Language';
  readonly nodeType = 'Language';
  width = 200;
  height: number | undefined = undefined;

  private language: string = 'jpn';

  // Input observable
  private input$: Observable<EventSignal> | null = null;

  // Output observable
  private outputSubject = new Subject<EventSignal>();
  public output$: Observable<EventSignal> = this.outputSubject.asObservable().pipe(share());

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  constructor() {
    super(i18next.t('nodes.language.title'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Input'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    this.addControl(
      'language',
      new SelectControl(
        this.language,
        i18next.t('nodes.language.language'),
        LANGUAGES,
        (value) => {
          this.language = value;
        }
      )
    );
  }

  getLanguage(): string {
    return this.language;
  }

  detectLanguage(content: string): string | null {
    if (!content || content.length < 10) return null;

    try {
      const detected = franc(content);
      // franc returns 'und' for undetermined
      if (detected === 'und') return null;
      return detected;
    } catch {
      return null;
    }
  }

  matches(content: string): boolean {
    const detected = this.detectLanguage(content);
    if (DEBUG) console.log('Language detection:', { content: content.substring(0, 50), detected, target: this.language, match: detected === this.language });
    if (detected === null) {
      // Undetectable language - filter out
      return false;
    }
    return detected === this.language;
  }

  serialize() {
    return {
      language: this.language,
    };
  }

  deserialize(data: { language: string }) {
    this.language = data.language;

    const languageControl = this.controls['language'] as SelectControl;
    if (languageControl) {
      languageControl.value = this.language;
    }
  }

  setInput(input: Observable<EventSignal> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    this.stopSubscription();

    if (!this.input$) return;

    this.subscription = this.input$.pipe(
      filter((signal) => this.matches(signal.event.content))
    ).subscribe({
      next: (signal) => this.outputSubject.next(signal),
    });
  }

  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  dispose(): void {
    this.stopSubscription();
  }
}
