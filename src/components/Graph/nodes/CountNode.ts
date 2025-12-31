import { ClassicPreset } from 'rete';
import { ReplaySubject, Observable, shareReplay } from 'rxjs';
import i18next from 'i18next';
import {
  anySocket,
  integerSocket,
} from './types';

// Output signal type
export interface IntegerSignal {
  type: 'integer';
  value: number;
}

export class CountNode extends ClassicPreset.Node {
  static readonly nodeType = 'Count';
  readonly nodeType = 'Count';
  width = 140;
  height: number | undefined = undefined;

  // Input observable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private input$: Observable<any> | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  // Count value
  private count = 0;

  // Output observable - use ReplaySubject(1) so late subscribers get the last value
  private outputSubject = new ReplaySubject<IntegerSignal>(1);
  public output$: Observable<IntegerSignal> = this.outputSubject.asObservable().pipe(shareReplay(1));

  constructor() {
    super(i18next.t('nodes.count.title', 'Count'));

    // Input socket (accepts any type)
    this.addInput('input', new ClassicPreset.Input(anySocket, 'Input'));
    // Output socket (integer)
    this.addOutput('output', new ClassicPreset.Output(integerSocket, 'Count'));

    // Emit initial count (0)
    this.outputSubject.next({ type: 'integer', value: this.count });
  }

  getCount(): number {
    return this.count;
  }

  // Set input observable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setInput(input: Observable<any> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    // Cleanup existing subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    // Recreate output subject to allow re-emission after completion
    this.outputSubject = new ReplaySubject<IntegerSignal>(1);
    this.output$ = this.outputSubject.asObservable().pipe(shareReplay(1));

    // Reset count when input changes
    this.count = 0;
    this.outputSubject.next({ type: 'integer', value: this.count });

    if (!this.input$) return;

    this.subscription = this.input$.subscribe({
      next: () => {
        // Increment count for each received input
        this.count++;
        this.outputSubject.next({ type: 'integer', value: this.count });
      },
      complete: () => {
        // Propagate complete to output
        this.outputSubject.complete();
      },
    });
  }

  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  serialize() {
    return {
      count: this.count,
    };
  }

  deserialize(data: { count?: number }) {
    if (data.count !== undefined) {
      this.count = data.count;
      this.outputSubject.next({ type: 'integer', value: this.count });
    }
  }
}
