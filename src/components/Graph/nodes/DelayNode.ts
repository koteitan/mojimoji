import { ClassicPreset } from 'rete';
import { Observable, Subject, share, delay } from 'rxjs';
import i18next from 'i18next';
import { anySocket } from './types';
import { TextInputControl, SelectControl } from './controls';

export type DelayUnit = 'ms' | 'sec' | 'min';

export class DelayNode extends ClassicPreset.Node {
  static readonly nodeType = 'Delay';
  readonly nodeType = 'Delay';
  width = 180;
  height: number | undefined = undefined;

  private delayValue: number = 100;
  private delayUnit: DelayUnit = 'ms';

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
    super(i18next.t('nodes.delay.title', 'Delay'));

    this.addInput('input', new ClassicPreset.Input(anySocket, 'Input'));
    this.addOutput('output', new ClassicPreset.Output(anySocket, 'Output'));

    this.addControl(
      'delay',
      new TextInputControl(
        String(this.delayValue),
        i18next.t('nodes.delay.delay', 'Delay'),
        (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed >= 0) {
            this.delayValue = parsed;
            this.rebuildPipeline();
          }
        },
        false,
        '100'
      )
    );

    this.addControl(
      'unit',
      new SelectControl(
        this.delayUnit,
        i18next.t('nodes.delay.unit', 'Unit'),
        [
          { value: 'ms', label: 'ms' },
          { value: 'sec', label: 'sec' },
          { value: 'min', label: 'min' },
        ],
        (value) => {
          this.delayUnit = value as DelayUnit;
          this.rebuildPipeline();
        }
      )
    );
  }

  getDelayValue(): number {
    return this.delayValue;
  }

  getDelayUnit(): DelayUnit {
    return this.delayUnit;
  }

  // Get delay in milliseconds
  getDelayMs(): number {
    switch (this.delayUnit) {
      case 'ms':
        return this.delayValue;
      case 'sec':
        return this.delayValue * 1000;
      case 'min':
        return this.delayValue * 60 * 1000;
      default:
        return this.delayValue;
    }
  }

  serialize() {
    return {
      delayValue: this.delayValue,
      delayUnit: this.delayUnit,
    };
  }

  deserialize(data: { delayValue?: number; delayUnit?: DelayUnit }) {
    if (data.delayValue !== undefined) {
      this.delayValue = data.delayValue;
    }
    if (data.delayUnit !== undefined) {
      this.delayUnit = data.delayUnit;
    }

    const delayControl = this.controls['delay'] as TextInputControl;
    if (delayControl) {
      delayControl.value = String(this.delayValue);
    }

    const unitControl = this.controls['unit'] as SelectControl;
    if (unitControl) {
      unitControl.value = this.delayUnit;
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

    const delayMs = this.getDelayMs();

    this.subscription = this.input$.pipe(
      delay(delayMs)
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
