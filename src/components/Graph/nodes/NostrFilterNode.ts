import { ClassicPreset } from 'rete';
import { Observable, Subject, share, filter } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { SimpleFilterControl, type FilterElement } from './controls';
import { findPubkeysByName } from './SimpleRelayNode';
import type { EventSignal, NostrEvent } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64, parseDateToTimestamp } from '../../../nostr/types';

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
    return this.exclude ? !result : result;
  }

  private matchesFilter(event: NostrEvent): boolean {
    // All specified elements must match (AND logic between elements)
    // Empty values are ignored

    for (const element of this.filterElements) {
      const value = element.value?.trim();
      if (!value) continue; // Skip empty values

      switch (element.field) {
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
        case '#t': {
          const tagName = element.field.slice(1);
          const targetValues = this.resolveTagValues(value, element.field);
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
}
