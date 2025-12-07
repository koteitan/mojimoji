import { ClassicPreset } from 'rete';
import { Observable } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextInputControl } from './controls';
import type { NostrEvent } from '../../../nostr/types';

export class DisplayNode extends ClassicPreset.Node {
  width = 180;
  height = 120;

  private timelineName: string = 'Timeline';

  // Input observable (set by GraphEditor when connections change)
  private input$: Observable<NostrEvent> | null = null;

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  // Callback for when events arrive
  private onEvent: ((event: NostrEvent) => void) | null = null;

  constructor() {
    super(i18next.t('nodes.display.title'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Events'));

    this.addControl(
      'name',
      new TextInputControl(
        this.timelineName,
        i18next.t('nodes.display.name'),
        (value) => {
          this.timelineName = value;
        }
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

  // Set the event callback
  setOnEvent(callback: (event: NostrEvent) => void): void {
    this.onEvent = callback;
  }

  // Set input observable and start subscription
  setInput(input: Observable<NostrEvent> | null): void {
    this.input$ = input;
    this.rebuildSubscription();
  }

  // Rebuild subscription
  private rebuildSubscription(): void {
    // Cleanup existing subscription
    this.stopSubscription();

    if (!this.input$ || !this.onEvent) return;

    this.subscription = this.input$.subscribe({
      next: (event) => {
        if (this.onEvent) {
          this.onEvent(event);
        }
      },
      error: (err) => {
        console.error('DisplayNode subscription error:', err);
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
