import { ClassicPreset } from 'rete';
import { Observable, Subject, share, filter } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextInputControl, CheckboxControl } from './controls';
import type { NostrEvent } from '../../../nostr/types';

export class SearchNode extends ClassicPreset.Node {
  width = 200;
  height = 160;

  private keyword: string = '';
  private useRegex: boolean = false;

  // Input observable (set by GraphEditor when connections change)
  private input$: Observable<NostrEvent> | null = null;

  // Output observable
  private outputSubject = new Subject<NostrEvent>();
  public output$: Observable<NostrEvent> = this.outputSubject.asObservable().pipe(share());

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
  }

  getKeyword(): string {
    return this.keyword;
  }

  isRegex(): boolean {
    return this.useRegex;
  }

  matches(content: string): boolean {
    if (!this.keyword) return true;

    if (this.useRegex) {
      try {
        const regex = new RegExp(this.keyword, 'i');
        return regex.test(content);
      } catch {
        return false;
      }
    }

    return content.toLowerCase().includes(this.keyword.toLowerCase());
  }

  serialize() {
    return {
      keyword: this.keyword,
      useRegex: this.useRegex,
    };
  }

  deserialize(data: { keyword: string; useRegex: boolean }) {
    this.keyword = data.keyword;
    this.useRegex = data.useRegex;

    const keywordControl = this.controls['keyword'] as TextInputControl;
    if (keywordControl) {
      keywordControl.value = this.keyword;
    }

    const regexControl = this.controls['regex'] as CheckboxControl;
    if (regexControl) {
      regexControl.checked = this.useRegex;
    }
  }

  // Set input observable and rebuild the pipeline
  setInput(input: Observable<NostrEvent> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  // Rebuild the observable pipeline
  private rebuildPipeline(): void {
    // Cleanup existing subscription
    this.stopSubscription();

    if (!this.input$) return;

    this.subscription = this.input$.pipe(
      filter((event) => this.matches(event.content))
    ).subscribe({
      next: (event) => this.outputSubject.next(event),
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
