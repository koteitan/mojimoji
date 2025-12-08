import { ClassicPreset } from 'rete';
import { Observable } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextInputControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

export class TimelineNode extends ClassicPreset.Node {
  static readonly nodeType = 'Timeline';
  readonly nodeType = 'Timeline';
  width = 180;
  height: number | undefined = undefined; // auto-calculated based on content

  private timelineName: string = 'Timeline';

  // Input observable (set by GraphEditor when connections change)
  private input$: Observable<EventSignal> | null = null;

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  // Callback for when event signals arrive
  private onSignal: ((signal: EventSignal) => void) | null = null;

  constructor() {
    super(i18next.t('nodes.timeline.title'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Events'));

    this.addControl(
      'name',
      new TextInputControl(
        this.timelineName,
        i18next.t('nodes.timeline.name'),
        (value) => {
          this.timelineName = value;
        },
        false // Don't rebuild pipeline on name change
      )
    );
  }

  getTimelineName(): string {
    return this.timelineName;
  }

  serialize() {
    return {
      timelineName: this.timelineName,
    };
  }

  deserialize(data: { timelineName: string }) {
    this.timelineName = data.timelineName;

    const control = this.controls['name'] as TextInputControl;
    if (control) {
      control.value = this.timelineName;
    }
  }

  // Set the signal callback
  setOnSignal(callback: (signal: EventSignal) => void): void {
    this.onSignal = callback;
  }

  // Set input observable and start subscription
  setInput(input: Observable<EventSignal> | null): void {
    this.input$ = input;
    this.rebuildSubscription();
  }

  // Rebuild subscription
  private rebuildSubscription(): void {
    // Cleanup existing subscription
    this.stopSubscription();

    if (!this.input$ || !this.onSignal) return;

    this.subscription = this.input$.subscribe({
      next: (signal) => {
        if (this.onSignal) {
          this.onSignal(signal);
        }
      },
      error: (err) => {
        console.error('TimelineNode subscription error:', err);
      },
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
