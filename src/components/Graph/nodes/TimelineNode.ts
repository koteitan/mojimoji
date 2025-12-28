import { ClassicPreset } from 'rete';
import { Observable } from 'rxjs';
import i18next from 'i18next';
import { anySocket } from './types';
import { TextInputControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

// Data types that Timeline can display
export type TimelineDataType = 'event' | 'eventId' | 'pubkey' | 'relay' | 'flag' | 'integer' | 'datetime' | 'relayStatus';

// Generic signal for Timeline with dynamically detected type
export interface TimelineSignal {
  type: TimelineDataType;
  data: unknown;
  signal: 'add' | 'remove';
}

// Helper to detect data type from raw signal
function detectDataType(rawSignal: unknown): TimelineDataType {
  if (rawSignal === null || rawSignal === undefined) {
    return 'flag'; // Default for null/undefined
  }

  // Check for EventSignal (has event and signal properties)
  if (typeof rawSignal === 'object' && 'event' in rawSignal) {
    const eventCandidate = (rawSignal as { event: unknown }).event;
    if (eventCandidate && typeof eventCandidate === 'object' && 'kind' in eventCandidate) {
      return 'event';
    }
  }

  // Check for relay status signal (has relay and status properties)
  if (typeof rawSignal === 'object' && 'relay' in rawSignal && 'status' in rawSignal) {
    return 'relayStatus';
  }

  // Check for RelaySignal from ExtractionNode (has relay string and signal)
  if (typeof rawSignal === 'object' && 'relay' in rawSignal && typeof (rawSignal as { relay: unknown }).relay === 'string') {
    return 'relay';
  }

  // Check for PubkeySignal (from NIP-07 node: { pubkey: string })
  if (typeof rawSignal === 'object' && 'pubkey' in rawSignal && typeof (rawSignal as { pubkey: unknown }).pubkey === 'string') {
    return 'pubkey';
  }

  // Check for FlagSignal (from If node: { flag: boolean })
  if (typeof rawSignal === 'object' && 'flag' in rawSignal && typeof (rawSignal as { flag: unknown }).flag === 'boolean') {
    return 'flag';
  }

  // Check for flag (boolean or 0/1)
  if (typeof rawSignal === 'boolean') {
    return 'flag';
  }

  // Check for integer
  if (typeof rawSignal === 'number' && Number.isInteger(rawSignal)) {
    // Could be integer or datetime (unix timestamp)
    // Timestamps are typically > 1000000000 (year 2001+)
    if (rawSignal > 1000000000 && rawSignal < 10000000000) {
      return 'datetime';
    }
    return 'integer';
  }

  // Check for string types
  if (typeof rawSignal === 'string') {
    // Check for relay URL
    if (rawSignal.startsWith('wss://') || rawSignal.startsWith('ws://')) {
      return 'relay';
    }
    // Check for hex (64 char = event id or pubkey)
    if (/^[0-9a-fA-F]{64}$/.test(rawSignal)) {
      // Could be event id or pubkey - default to eventId
      return 'eventId';
    }
    // Check for npub/note bech32
    if (rawSignal.startsWith('npub1')) {
      return 'pubkey';
    }
    if (rawSignal.startsWith('note1') || rawSignal.startsWith('nevent1')) {
      return 'eventId';
    }
  }

  // Check for array (could be relay array)
  if (Array.isArray(rawSignal)) {
    if (rawSignal.length > 0 && typeof rawSignal[0] === 'string') {
      if (rawSignal[0].startsWith('wss://') || rawSignal[0].startsWith('ws://')) {
        return 'relay';
      }
    }
  }

  // Check for object with specific properties
  if (typeof rawSignal === 'object') {
    // Could be a wrapped value with type info
    const obj = rawSignal as Record<string, unknown>;
    if ('type' in obj && typeof obj.type === 'string') {
      const declaredType = obj.type as string;
      if (['event', 'eventId', 'pubkey', 'relay', 'flag', 'integer', 'datetime', 'relayStatus'].includes(declaredType)) {
        return declaredType as TimelineDataType;
      }
    }
  }

  // Default to flag for unknown types
  return 'flag';
}

// Helper to extract the actual data from raw signal
function extractData(rawSignal: unknown, detectedType: TimelineDataType): unknown {
  // For EventSignal, return the whole signal
  if (detectedType === 'event' && typeof rawSignal === 'object' && rawSignal !== null && 'event' in rawSignal) {
    return rawSignal;
  }

  // For relay status from ModularRelayNode, return the signal
  if (detectedType === 'relayStatus' && typeof rawSignal === 'object' && rawSignal !== null && 'relay' in rawSignal && 'status' in rawSignal) {
    return rawSignal;
  }

  // For RelaySignal from ExtractionNode, return the relay string
  if (detectedType === 'relay' && typeof rawSignal === 'object' && rawSignal !== null && 'relay' in rawSignal) {
    return (rawSignal as { relay: string }).relay;
  }

  // For PubkeySignal format (from NIP-07 node: { pubkey: string })
  if (detectedType === 'pubkey' && typeof rawSignal === 'object' && rawSignal !== null && 'pubkey' in rawSignal) {
    return (rawSignal as { pubkey: string }).pubkey;
  }

  // For FlagSignal format (from If node: { flag: boolean })
  if (detectedType === 'flag' && typeof rawSignal === 'object' && rawSignal !== null && 'flag' in rawSignal) {
    return (rawSignal as { flag: boolean }).flag;
  }

  // For ConstantSignal format (has 'type' and 'value' properties)
  if (typeof rawSignal === 'object' && rawSignal !== null && 'value' in rawSignal) {
    return (rawSignal as { value: unknown }).value;
  }

  // For wrapped values with data property
  if (typeof rawSignal === 'object' && rawSignal !== null && 'data' in rawSignal) {
    return (rawSignal as { data: unknown }).data;
  }

  // Return as-is for primitive types
  return rawSignal;
}

export class TimelineNode extends ClassicPreset.Node {
  static readonly nodeType = 'Timeline';
  readonly nodeType = 'Timeline';
  width = 180;
  height: number | undefined = undefined; // auto-calculated based on content

  private timelineName: string = 'Timeline';

  // Input observable (set by GraphEditor when connections change)
  private input$: Observable<unknown> | null = null;

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  // Debug counters
  private eventCount = 0;
  private lastEventTime: number | null = null;

  // Callback for when signals arrive (generic - detects type dynamically)
  private onSignal: ((signal: TimelineSignal) => void) | null = null;

  // For backward compatibility, also support EventSignal callback
  private onEventSignal: ((signal: EventSignal) => void) | null = null;

  constructor() {
    super(i18next.t('nodes.timeline.title'));

    // Use anySocket to accept any type of input
    this.addInput('input', new ClassicPreset.Input(anySocket, 'Input'));

    // Timeline name control
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

  deserialize(data: { timelineName?: string }) {
    this.timelineName = data.timelineName || 'Timeline';

    const nameControl = this.controls['name'] as TextInputControl;
    if (nameControl) {
      nameControl.value = this.timelineName;
    }
  }

  // Set the signal callback (generic - type is detected dynamically)
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

        // Detect the type dynamically
        const detectedType = detectDataType(rawSignal);

        // For backward compatibility, call onEventSignal for event type
        if (detectedType === 'event' && this.onEventSignal) {
          this.onEventSignal(rawSignal as EventSignal);
        }

        // Call the generic onSignal callback
        if (this.onSignal) {
          const timelineSignal: TimelineSignal = {
            type: detectedType,
            data: extractData(rawSignal, detectedType),
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
