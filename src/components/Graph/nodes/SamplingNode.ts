import { ClassicPreset } from 'rete';
import { Observable, Subject, share, filter } from 'rxjs';
import i18next from 'i18next';
import { anySocket } from './types';
import { TextInputControl } from './controls';

export class SamplingNode extends ClassicPreset.Node {
  static readonly nodeType = 'Sampling';
  readonly nodeType = 'Sampling';
  width = 180;
  height: number | undefined = undefined;

  private numerator: number = 1.0;
  private denominator: number = 1.0;

  // Input observable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private input$: Observable<any> | null = null;

  // Output observable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private outputSubject = new Subject<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public output$: Observable<any> = this.outputSubject.asObservable().pipe(share());

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  constructor() {
    super(i18next.t('nodes.sampling.title', 'Sampling'));

    this.addInput('input', new ClassicPreset.Input(anySocket, 'Input'));
    this.addOutput('output', new ClassicPreset.Output(anySocket, 'Output'));

    this.addControl(
      'numerator',
      new TextInputControl(
        String(this.numerator),
        i18next.t('nodes.sampling.numerator', 'Numerator'),
        (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed >= 0) {
            this.numerator = parsed;
          }
        },
        false, // rebuildPipeline not needed - just changes probability
        '1.0'
      )
    );

    this.addControl(
      'denominator',
      new TextInputControl(
        String(this.denominator),
        i18next.t('nodes.sampling.denominator', 'Denominator'),
        (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.denominator = parsed;
          }
        },
        false,
        '1.0'
      )
    );
  }

  getNumerator(): number {
    return this.numerator;
  }

  getDenominator(): number {
    return this.denominator;
  }

  getProbability(): number {
    if (this.denominator === 0) return 0;
    return this.numerator / this.denominator;
  }

  serialize() {
    return {
      numerator: this.numerator,
      denominator: this.denominator,
    };
  }

  deserialize(data: { numerator?: number; denominator?: number }) {
    if (data.numerator !== undefined) {
      this.numerator = data.numerator;
    }
    if (data.denominator !== undefined) {
      this.denominator = data.denominator;
    }

    const numeratorControl = this.controls['numerator'] as TextInputControl;
    if (numeratorControl) {
      numeratorControl.value = String(this.numerator);
    }

    const denominatorControl = this.controls['denominator'] as TextInputControl;
    if (denominatorControl) {
      denominatorControl.value = String(this.denominator);
    }
  }

  // Set input observable and rebuild the pipeline
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setInput(input: Observable<any> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  // Rebuild the observable pipeline
  private rebuildPipeline(): void {
    // Cleanup existing subscription
    this.stopSubscription();

    if (!this.input$) return;

    this.subscription = this.input$.pipe(
      filter(() => {
        const probability = this.getProbability();
        const random = Math.random();
        return random < probability;
      })
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
