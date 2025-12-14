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

  // Debug counters
  private eventCount = 0;
  private lastEventTime: number | null = null;

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

    // Reset debug counters
    this.eventCount = 0;
    this.lastEventTime = null;

    this.subscription = this.input$.subscribe({
      next: (signal) => {
        this.eventCount++;
        this.lastEventTime = Date.now();
        if (this.onSignal) {
          this.onSignal(signal);
        }
      },
      error: (err) => {
        console.error(`[TimelineNode ${this.id.slice(0, 8)}] Subscription error:`, err);
      },
      complete: () => {
        console.warn(`[TimelineNode ${this.id.slice(0, 8)}] Subscription completed unexpectedly`);
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

  // Check if subscribed
  isSubscribed(): boolean {
    return this.subscription !== null;
  }

  // Get debug info
  getDebugInfo(): {
    nodeId: string;
    subscribed: boolean;
    hasInput: boolean;
    hasCallback: boolean;
    eventCount: number;
    lastEventAgo: string | null;
  } {
    let lastEventAgo: string | null = null;
    if (this.lastEventTime) {
      const seconds = Math.floor((Date.now() - this.lastEventTime) / 1000);
      if (seconds < 60) {
        lastEventAgo = `${seconds}s ago`;
      } else if (seconds < 3600) {
        lastEventAgo = `${Math.floor(seconds / 60)}m ago`;
      } else {
        lastEventAgo = `${Math.floor(seconds / 3600)}h ago`;
      }
    }
    return {
      nodeId: this.id.slice(0, 8),
      subscribed: this.subscription !== null,
      hasInput: this.input$ !== null,
      hasCallback: this.onSignal !== null,
      eventCount: this.eventCount,
      lastEventAgo,
    };
  }
}
