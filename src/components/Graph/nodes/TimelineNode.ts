import { ClassicPreset } from 'rete';
import { Observable } from 'rxjs';
import i18next from 'i18next';
import {
  eventSocket,
  eventIdSocket,
  pubkeySocket,
  relaySocket,
  flagSocket,
  integerSocket,
  datetimeSocket,
  relayStatusSocket,
} from './types';
import { TextInputControl, SelectControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

// Data types that Timeline can display
export type TimelineDataType = 'event' | 'eventId' | 'pubkey' | 'relay' | 'flag' | 'integer' | 'datetime' | 'relayStatus';

// Generic signal for Timeline
export interface TimelineSignal {
  type: TimelineDataType;
  data: unknown;
  signal: 'add' | 'remove';
}

// Get socket for data type
function getSocketForDataType(dataType: TimelineDataType): ClassicPreset.Socket {
  switch (dataType) {
    case 'event': return eventSocket;
    case 'eventId': return eventIdSocket;
    case 'pubkey': return pubkeySocket;
    case 'relay': return relaySocket;
    case 'flag': return flagSocket;
    case 'integer': return integerSocket;
    case 'datetime': return datetimeSocket;
    case 'relayStatus': return relayStatusSocket;
  }
}

export class TimelineNode extends ClassicPreset.Node {
  static readonly nodeType = 'Timeline';
  readonly nodeType = 'Timeline';
  width = 180;
  height: number | undefined = undefined; // auto-calculated based on content

  private timelineName: string = 'Timeline';
  private dataType: TimelineDataType = 'event';

  // Input observable (set by GraphEditor when connections change)
  private input$: Observable<unknown> | null = null;

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  // Debug counters
  private eventCount = 0;
  private lastEventTime: number | null = null;

  // Callback for when signals arrive
  private onSignal: ((signal: TimelineSignal) => void) | null = null;

  // For backward compatibility, also support EventSignal callback
  private onEventSignal: ((signal: EventSignal) => void) | null = null;

  constructor() {
    super(i18next.t('nodes.timeline.title'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Input'));

    // Data type selector
    this.addControl(
      'dataType',
      new SelectControl(
        this.dataType,
        i18next.t('nodes.timeline.dataType', 'Type'),
        [
          { value: 'event', label: 'Event' },
          { value: 'eventId', label: 'Event ID' },
          { value: 'pubkey', label: 'Pubkey' },
          { value: 'relay', label: 'Relay' },
          { value: 'flag', label: 'Flag' },
          { value: 'integer', label: 'Integer' },
          { value: 'datetime', label: 'Datetime' },
          { value: 'relayStatus', label: 'Relay Status' },
        ],
        (value) => {
          this.dataType = value as TimelineDataType;
          this.updateInputSocket();
        }
      )
    );

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

  private updateInputSocket(): void {
    this.removeInput('input');
    const socket = getSocketForDataType(this.dataType);
    this.addInput('input', new ClassicPreset.Input(socket, 'Input'));
  }

  getTimelineName(): string {
    return this.timelineName;
  }

  getDataType(): TimelineDataType {
    return this.dataType;
  }

  serialize() {
    return {
      timelineName: this.timelineName,
      dataType: this.dataType,
    };
  }

  deserialize(data: { timelineName: string; dataType?: TimelineDataType }) {
    this.timelineName = data.timelineName;
    this.dataType = data.dataType || 'event';

    const nameControl = this.controls['name'] as TextInputControl;
    if (nameControl) {
      nameControl.value = this.timelineName;
    }

    const dataTypeControl = this.controls['dataType'] as SelectControl;
    if (dataTypeControl) {
      dataTypeControl.value = this.dataType;
    }

    this.updateInputSocket();
  }

  // Set the signal callback (generic)
  setOnTimelineSignal(callback: (signal: TimelineSignal) => void): void {
    this.onSignal = callback;
  }

  // Set the signal callback (for backward compatibility with EventSignal)
  setOnSignal(callback: (signal: EventSignal) => void): void {
    this.onEventSignal = callback;
  }

  // Set input observable and start subscription
  setInput(input: Observable<unknown> | null): void {
    this.input$ = input;
    this.rebuildSubscription();
  }

  // Rebuild subscription
  private rebuildSubscription(): void {
    // Cleanup existing subscription
    this.stopSubscription();

    if (!this.input$) return;
    if (!this.onSignal && !this.onEventSignal) return;

    // Reset debug counters
    this.eventCount = 0;
    this.lastEventTime = null;

    this.subscription = this.input$.subscribe({
      next: (rawSignal) => {
        this.eventCount++;
        this.lastEventTime = Date.now();

        // For backward compatibility, call onEventSignal for event type
        if (this.dataType === 'event' && this.onEventSignal) {
          this.onEventSignal(rawSignal as EventSignal);
        }

        // Call the generic onSignal callback
        if (this.onSignal) {
          const timelineSignal: TimelineSignal = {
            type: this.dataType,
            data: rawSignal,
            signal: this.extractSignalType(rawSignal),
          };
          this.onSignal(timelineSignal);
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

  // Extract signal type from raw signal
  private extractSignalType(rawSignal: unknown): 'add' | 'remove' {
    if (rawSignal && typeof rawSignal === 'object' && 'signal' in rawSignal) {
      return (rawSignal as { signal: 'add' | 'remove' }).signal;
    }
    return 'add';
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
