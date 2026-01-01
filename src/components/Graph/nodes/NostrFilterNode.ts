import { ClassicPreset } from 'rete';
import { Observable, Subject, share, filter } from 'rxjs';
import i18next from 'i18next';
import { eventSocket, datetimeSocket, eventIdSocket, pubkeySocket } from './types';
import { SimpleFilterControl, isSocketField, getBaseField, type FilterElement } from './controls';
import { findPubkeysByName } from './SimpleRelayNode';
import type { EventSignal, NostrEvent } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64, parseDateToTimestamp } from '../../../nostr/types';
import type { EventIdSignal, PubkeySignal, DatetimeSignal } from './ExtractionNode';

// Get socket type for a filter field
function getSocketForField(field: string): ClassicPreset.Socket {
  const baseField = getBaseField(field);
  switch (baseField) {
    case 'since':
    case 'until':
      return datetimeSocket;
    case '#e':
    case '#q':
      return eventIdSocket;
    case 'authors':
    case '#p':
      return pubkeySocket;
    default:
      return eventIdSocket;
  }
}

// Generate socket key from element index
function makeSocketKey(elementIndex: number): string {
  return `filter_${elementIndex}`;
}

export class NostrFilterNode extends ClassicPreset.Node {
  static readonly nodeType = 'NostrFilter';
  readonly nodeType = 'NostrFilter';
  width = 200;
  height: number | undefined = undefined;

  // Filter elements
  private filterElements: FilterElement[] = [{ field: 'kinds', value: '' }];
  private exclude: boolean = false;

  // Input observable
  private input$: Observable<EventSignal> | null = null;

  // Output observable
  private outputSubject = new Subject<EventSignal>();
  public output$: Observable<EventSignal> = this.outputSubject.asObservable().pipe(share());

  // Subscription
  private subscription: { unsubscribe: () => void } | null = null;

  // Track current dynamic input sockets (key -> field type)
  private currentSockets: Map<string, string> = new Map();

  // Socket input values (key -> values array)
  private socketValues: Map<string, unknown[]> = new Map();

  // Socket input subscriptions (key -> subscription)
  private socketSubscriptions: Map<string, { unsubscribe: () => void }> = new Map();

  constructor() {
    super(i18next.t('nodes.nostrFilter.title'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Input'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    // Add simple filter control
    this.addControl(
      'filter',
      new SimpleFilterControl(
        this.filterElements,
        this.exclude,
        i18next.t('nodes.nostrFilter.exclude'),
        (elements, exclude) => {
          this.filterElements = elements;
          this.exclude = exclude;
          this.updateSocketsFromFilters();
        }
      )
    );
  }

  serialize() {
    return {
      filterElements: [...this.filterElements],
      exclude: this.exclude,
    };
  }

  deserialize(data: { filterElements: FilterElement[]; exclude: boolean }) {
    this.filterElements = [...data.filterElements];
    this.exclude = data.exclude;

    // Update control
    const control = this.controls['filter'] as SimpleFilterControl;
    if (control) {
      control.elements = this.filterElements;
      control.exclude = this.exclude;
    }

    // Update sockets based on loaded filter elements
    this.updateSocketsFromFilters();
  }

  setInput(input: Observable<EventSignal> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    this.stopSubscription();

    if (!this.input$) return;

    this.subscription = this.input$.pipe(
      filter((signal) => this.matches(signal.event))
    ).subscribe({
      next: (signal) => this.outputSubject.next(signal),
    });
  }

  // Check if an event matches the filter criteria
  private matches(event: NostrEvent): boolean {
    const result = this.matchesFilter(event);
    const finalResult = this.exclude ? !result : result;
    // Debug: log first few filter decisions
    if (!NostrFilterNode.debugCount) NostrFilterNode.debugCount = 0;
    if (NostrFilterNode.debugCount < 3) {
      console.log(`[NostrFilter] event kind=${event.kind}, filterResult=${result}, exclude=${this.exclude}, pass=${finalResult}, elements=`, JSON.stringify(this.filterElements));
      NostrFilterNode.debugCount++;
    }
    return finalResult;
  }
  private static debugCount = 0;

  private matchesFilter(event: NostrEvent): boolean {
    // All specified elements must match (AND logic between elements)
    // Empty values are ignored for non-socket fields

    for (let i = 0; i < this.filterElements.length; i++) {
      const element = this.filterElements[i];
      const baseField = getBaseField(element.field);
      const isSocket = isSocketField(element.field);

      // For socket fields, get values from socket; for regular fields, parse from value string
      if (isSocket) {
        const socketValues = this.getSocketValuesForElement(i);
        if (socketValues.length === 0) continue; // Skip if no socket values yet

        switch (baseField) {
          case 'authors': {
            if (!socketValues.includes(event.pubkey)) {
              return false;
            }
            break;
          }
          case '#e':
          case '#p':
          case '#q': {
            const tagName = baseField.slice(1);
            const eventTags = event.tags
              .filter(tag => tag[0] === tagName)
              .map(tag => tag[1]);
            const hasMatch = socketValues.some(v => eventTags.includes(v as string));
            if (!hasMatch) {
              return false;
            }
            break;
          }
          case 'since': {
            // Use the minimum timestamp from socket values
            const timestamps = socketValues.filter(v => typeof v === 'number') as number[];
            if (timestamps.length > 0) {
              const sinceTimestamp = Math.min(...timestamps);
              if (event.created_at < sinceTimestamp) {
                return false;
              }
            }
            break;
          }
          case 'until': {
            // Use the maximum timestamp from socket values
            const timestamps = socketValues.filter(v => typeof v === 'number') as number[];
            if (timestamps.length > 0) {
              const untilTimestamp = Math.max(...timestamps);
              if (event.created_at > untilTimestamp) {
                return false;
              }
            }
            break;
          }
        }
      } else {
        // Regular field with value input
        const value = element.value?.trim();
        if (!value) continue; // Skip empty values

        switch (baseField) {
          case 'kinds': {
            const kinds = value.split(',')
              .map(v => parseInt(v.trim(), 10))
              .filter(n => !isNaN(n));
            if (kinds.length > 0 && !kinds.includes(event.kind)) {
              return false;
            }
            break;
          }
          case 'authors': {
            const authorMatches = this.resolveAuthors(value);
            if (authorMatches.length > 0 && !authorMatches.includes(event.pubkey)) {
              return false;
            }
            break;
          }
          case '#e':
          case '#p':
          case '#q':
          case '#t': {
            const tagName = baseField.slice(1);
            const targetValues = this.resolveTagValues(value, baseField);
            if (targetValues.length > 0) {
              const eventTags = event.tags
                .filter(tag => tag[0] === tagName)
                .map(tag => tag[1]);
              const hasMatch = targetValues.some(v => eventTags.includes(v));
              if (!hasMatch) {
                return false;
              }
            }
            break;
          }
          case 'since': {
            const sinceTimestamp = this.parseTimestamp(value);
            if (sinceTimestamp !== null && event.created_at < sinceTimestamp) {
              return false;
            }
            break;
          }
          case 'until': {
            const untilTimestamp = this.parseTimestamp(value);
            if (untilTimestamp !== null && event.created_at > untilTimestamp) {
              return false;
            }
            break;
          }
        }
      }
    }

    return true;
  }

  // Resolve authors field: supports hex, npub, name/display_name partial match
  private resolveAuthors(value: string): string[] {
    const results: string[] = [];
    const parts = value.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Try bech32 decode
      const decoded = decodeBech32ToHex(trimmed);
      if (decoded) {
        results.push(decoded.hex);
        continue;
      }

      // Check if hex
      if (isHex64(trimmed)) {
        results.push(trimmed.toLowerCase());
        continue;
      }

      // Name/display_name partial match lookup (all matches)
      const matchedPubkeys = findPubkeysByName(trimmed);
      results.push(...matchedPubkeys);
    }

    return results;
  }

  // Resolve tag values: supports hex, bech32, name lookup for #p
  private resolveTagValues(value: string, field: string): string[] {
    const results: string[] = [];
    const parts = value.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Try bech32 decode
      const decoded = decodeBech32ToHex(trimmed);
      if (decoded) {
        results.push(decoded.hex);
        continue;
      }

      // Check if hex
      if (isHex64(trimmed)) {
        results.push(trimmed.toLowerCase());
        continue;
      }

      // For #p, try name lookup (first match only)
      if (field === '#p') {
        const matchedPubkeys = findPubkeysByName(trimmed);
        if (matchedPubkeys.length > 0) {
          results.push(matchedPubkeys[0]); // First match only for tags
          continue;
        }
      }

      // Pass through as-is (could be a hashtag for #t)
      results.push(trimmed);
    }

    return results;
  }

  // Parse timestamp from various formats
  private parseTimestamp(value: string): number | null {
    // Try date format first
    const timestamp = parseDateToTimestamp(value);
    if (timestamp !== null) {
      return timestamp;
    }

    // Fall back to integer parsing
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      return num;
    }

    return null;
  }

  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  // Update input sockets based on filter elements with socket fields
  updateSocketsFromFilters(): void {
    // Determine required sockets from filter elements
    const requiredSockets = new Map<string, string>();
    this.filterElements.forEach((element, index) => {
      if (isSocketField(element.field)) {
        const key = makeSocketKey(index);
        requiredSockets.set(key, element.field);
      }
    });

    // Remove sockets that are no longer needed
    for (const [key] of this.currentSockets) {
      if (!requiredSockets.has(key)) {
        this.removeInput(key);
        this.currentSockets.delete(key);
        this.socketValues.delete(key);
        const sub = this.socketSubscriptions.get(key);
        if (sub) {
          sub.unsubscribe();
          this.socketSubscriptions.delete(key);
        }
      }
    }

    // Add new sockets or update existing ones
    for (const [key, field] of requiredSockets) {
      const existingField = this.currentSockets.get(key);
      if (existingField !== field) {
        // Remove old socket if field type changed
        if (existingField) {
          this.removeInput(key);
          const sub = this.socketSubscriptions.get(key);
          if (sub) {
            sub.unsubscribe();
            this.socketSubscriptions.delete(key);
          }
        }

        // Add new socket
        const socket = getSocketForField(field);
        const baseField = getBaseField(field);
        this.addInput(key, new ClassicPreset.Input(socket, baseField));
        this.currentSockets.set(key, field);
        this.socketValues.set(key, []);
      }
    }

    // Notify that sockets changed (triggers node re-render)
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  // Set socket input observable and subscribe to it
  setSocketInput(key: string, input: Observable<EventIdSignal | PubkeySignal | DatetimeSignal> | null): void {
    // Unsubscribe existing
    const existingSub = this.socketSubscriptions.get(key);
    if (existingSub) {
      existingSub.unsubscribe();
      this.socketSubscriptions.delete(key);
    }

    // Clear values
    this.socketValues.set(key, []);

    if (!input) {
      console.log(`[NostrFilter] setSocketInput(${key}): no input`);
      return;
    }

    const field = this.currentSockets.get(key);
    if (!field) {
      console.log(`[NostrFilter] setSocketInput(${key}): no field in currentSockets`);
      return;
    }

    console.log(`[NostrFilter] setSocketInput(${key}): subscribing to ${field}`);

    // Subscribe and collect values
    const sub = input.subscribe({
      next: (signal: unknown) => {
        console.log(`[NostrFilter] socket ${key} received:`, signal);
        const values = this.socketValues.get(key) || [];
        let value: unknown;
        let operation: 'add' | 'remove' = 'add';

        // Handle both ConstantSignal format {type, value} and ExtractionNode format {pubkey/eventId/datetime, signal}
        const signalObj = signal as Record<string, unknown>;
        if ('type' in signalObj && 'value' in signalObj) {
          // ConstantSignal format: {type: 'pubkey', value: '...'}
          let rawValue = signalObj.value;
          // Decode bech32 if needed (e.g., npub to hex)
          if (typeof rawValue === 'string') {
            const decoded = decodeBech32ToHex(rawValue);
            if (decoded) {
              rawValue = decoded.hex;
            }
          }
          value = rawValue;
          operation = 'add'; // Constants are always 'add'
        } else if ('eventId' in signalObj) {
          value = signalObj.eventId;
          operation = (signalObj.signal as 'add' | 'remove') || 'add';
        } else if ('pubkey' in signalObj) {
          value = signalObj.pubkey;
          operation = (signalObj.signal as 'add' | 'remove') || 'add';
        } else if ('datetime' in signalObj) {
          value = signalObj.datetime;
          operation = (signalObj.signal as 'add' | 'remove') || 'add';
        }

        if (operation === 'add') {
          if (!values.includes(value)) {
            values.push(value);
            this.socketValues.set(key, values);
            console.log(`[NostrFilter] socket ${key} values now:`, values);
          }
        } else if (operation === 'remove') {
          const index = values.indexOf(value);
          if (index !== -1) {
            values.splice(index, 1);
            this.socketValues.set(key, values);
          }
        }
      },
      complete: () => {
        console.log(`[NostrFilter] socket ${key} completed, values:`, this.socketValues.get(key));
      },
    });

    this.socketSubscriptions.set(key, sub);
  }

  // Get socket values for a specific element index
  private getSocketValuesForElement(elementIndex: number): unknown[] {
    const key = makeSocketKey(elementIndex);
    return this.socketValues.get(key) || [];
  }

  // Get all current socket keys
  getSocketKeys(): string[] {
    return Array.from(this.currentSockets.keys());
  }
}
