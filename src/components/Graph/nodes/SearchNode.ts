import { ClassicPreset } from 'rete';
import { Observable, Subject, share, filter } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextInputControl, CheckboxControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

export class SearchNode extends ClassicPreset.Node {
  static readonly nodeType = 'Search';
  readonly nodeType = 'Search';
  width = 200;
  height: number | undefined = undefined; // auto-calculated based on content

  private keyword: string = '';
  private useRegex: boolean = false;
  private exclude: boolean = false;

  // Input observable (set by GraphEditor when connections change)
  private input$: Observable<EventSignal> | null = null;

  // Output observable
  private outputSubject = new Subject<EventSignal>();
  public output$: Observable<EventSignal> = this.outputSubject.asObservable().pipe(share());

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  constructor() {
    super(i18next.t('nodes.search.title'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Input'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    this.addControl(
      'keyword',
      new TextInputControl(
        this.keyword,
        i18next.t('nodes.search.keyword'),
        (value) => {
          this.keyword = value;
        }
      )
    );

    this.addControl(
      'regex',
      new CheckboxControl(
        this.useRegex,
        i18next.t('nodes.search.regex'),
        (checked) => {
          this.useRegex = checked;
        }
      )
    );

    this.addControl(
      'exclude',
      new CheckboxControl(
        this.exclude,
        i18next.t('nodes.search.exclude'),
        (checked) => {
          this.exclude = checked;
        }
      )
    );
  }

  getKeyword(): string {
    return this.keyword;
  }

  isRegex(): boolean {
    return this.useRegex;
  }

  isExclude(): boolean {
    return this.exclude;
  }

  matches(content: string): boolean {
    if (!this.keyword) return true;

    let matched: boolean;

    if (this.useRegex) {
      try {
        const regex = new RegExp(this.keyword, 'i');
        matched = regex.test(content);
      } catch {
        matched = false;
      }
    } else {
      matched = content.toLowerCase().includes(this.keyword.toLowerCase());
    }

    // If exclude mode, invert the result
    return this.exclude ? !matched : matched;
  }

  serialize() {
    return {
      keyword: this.keyword,
      useRegex: this.useRegex,
      exclude: this.exclude,
    };
  }

  deserialize(data: { keyword: string; useRegex: boolean; exclude?: boolean }) {
    this.keyword = data.keyword;
    this.useRegex = data.useRegex;
    this.exclude = data.exclude ?? false;

    const keywordControl = this.controls['keyword'] as TextInputControl;
    if (keywordControl) {
      keywordControl.value = this.keyword;
    }

    const regexControl = this.controls['regex'] as CheckboxControl;
    if (regexControl) {
      regexControl.checked = this.useRegex;
    }

    const excludeControl = this.controls['exclude'] as CheckboxControl;
    if (excludeControl) {
      excludeControl.checked = this.exclude;
    }
  }

  // Set input observable and rebuild the pipeline
  setInput(input: Observable<EventSignal> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  // Rebuild the observable pipeline
  private rebuildPipeline(): void {
    // Cleanup existing subscription
    this.stopSubscription();

    if (!this.input$) return;

    this.subscription = this.input$.pipe(
      filter((signal) => this.matches(signal.event.content))
    ).subscribe({
      next: (signal) => this.outputSubject.next(signal),
    });
  }

  // Stop subscription
  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
