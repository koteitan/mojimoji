import { ClassicPreset } from 'rete';
import { ReplaySubject, Observable, shareReplay } from 'rxjs';
import i18next from 'i18next';
import {
  anySocket,
  integerSocket,
} from './types';
import { normalizePubkeyToHex, normalizeEventIdToHex, type EventSignal } from '../../../nostr/types';

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

  // Track counted items and excluded items for proper set difference
  private countedItems = new Set<string>();
  private excludedItems = new Set<string>();

  // Track completion state
  private completed = false;

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

    // Reset count, sets, and completion state when input changes
    this.count = 0;
    this.countedItems.clear();
    this.excludedItems.clear();
    this.completed = false;
    this.outputSubject.next({ type: 'integer', value: this.count });

    if (!this.input$) return;

    this.subscription = this.input$.subscribe({
      next: (signal) => {
        // Extract item key for deduplication
        const itemKey = this.getItemKey(signal);

        // Check signal type (add or remove)
        const signalType: 'add' | 'remove' =
          (typeof signal === 'object' && signal !== null && 'signal' in signal)
            ? (signal as { signal: 'add' | 'remove' }).signal
            : 'add';

        if (signalType === 'add') {
          // Check if item is in excluded set (remove arrived before add)
          if (this.excludedItems.has(itemKey)) {
            // Already excluded - don't count, just remove from excluded
            this.excludedItems.delete(itemKey);
          } else if (!this.countedItems.has(itemKey)) {
            // Not excluded and not already counted - add to count
            this.countedItems.add(itemKey);
            this.count++;
            this.outputSubject.next({ type: 'integer', value: this.count });
          }
          // If already in countedItems, this is a duplicate - ignore
        } else {
          // Remove signal
          if (this.countedItems.has(itemKey)) {
            // Item was counted - remove it
            this.countedItems.delete(itemKey);
            this.count--;
            this.outputSubject.next({ type: 'integer', value: this.count });
          } else {
            // Item not found - add to excluded set for future add
            this.excludedItems.add(itemKey);
          }
        }
      },
      complete: () => {
        // Propagate complete to output
        this.completed = true;
        this.outputSubject.complete();
      },
    });
  }

  // Extract a unique key from signal for deduplication
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getItemKey(signal: any): string {
    if (!signal || typeof signal !== 'object') {
      return String(signal);
    }

    // Event signal
    if ('event' in signal && signal.event && typeof signal.event === 'object' && 'id' in signal.event) {
      return (signal as EventSignal).event.id.toLowerCase();
    }

    // EventId signal
    if ('eventId' in signal) {
      return `eventId:${normalizeEventIdToHex(signal.eventId)}`;
    }

    // Pubkey signal
    if ('pubkey' in signal) {
      return `pubkey:${normalizePubkeyToHex(signal.pubkey)}`;
    }

    // Relay signal
    if ('relay' in signal) {
      return `relay:${signal.relay}`;
    }
    if ('relays' in signal) {
      return `relay:${Array.isArray(signal.relays) ? signal.relays.join(',') : signal.relays}`;
    }

    // Flag signal
    if ('flag' in signal) {
      return `flag:${signal.flag}`;
    }

    // Integer signal
    if ('value' in signal && typeof signal.value === 'number') {
      return `integer:${signal.value}`;
    }

    // Datetime signal
    if ('datetime' in signal) {
      return `datetime:${signal.datetime}`;
    }

    // RelayStatus signal
    if ('status' in signal) {
      const relay = signal.relay || 'unknown';
      return `relayStatus:${relay}:${signal.status}`;
    }

    // Fallback: use timestamp to make each signal unique
    return `unknown:${Date.now()}:${Math.random()}`;
  }

  isComplete(): boolean {
    return this.completed;
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
