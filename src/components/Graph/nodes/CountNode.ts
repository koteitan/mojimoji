import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import i18next from 'i18next';
import {
  eventSocket,
  integerSocket,
} from './types';

// Output signal type
export interface IntegerSignal {
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

  // Output observable
  private outputSubject = new Subject<IntegerSignal>();
  public output$: Observable<IntegerSignal> = this.outputSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.count.title', 'Count'));

    // Input socket (accepts event type)
    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Input'));
    // Output socket (integer)
    this.addOutput('output', new ClassicPreset.Output(integerSocket, 'Count'));

    // Emit initial count (0)
    this.outputSubject.next({ value: this.count });
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

    // Reset count when input changes
    this.count = 0;
    this.outputSubject.next({ value: this.count });

    if (!this.input$) return;

    this.subscription = this.input$.subscribe({
      next: () => {
        // Increment count for each received input
        this.count++;
        this.outputSubject.next({ value: this.count });
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
      this.outputSubject.next({ value: this.count });
    }
  }
}
