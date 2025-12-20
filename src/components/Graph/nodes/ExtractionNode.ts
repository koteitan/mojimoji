import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import i18next from 'i18next';
import {
  eventSocket,
  eventIdSocket,
  pubkeySocket,
  datetimeSocket,
  relaySocket,
} from './types';
import { SelectControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

// Extraction field types
export type ExtractionField = 'eventId' | 'author' | 'created_at' | '#e' | '#p' | '#r';

// Relay filter types (for #r extraction)
export type RelayFilterType = 'all' | 'read' | 'write' | 'readWrite';

// Signal types for different extracted values
export interface EventIdSignal {
  eventId: string;
  signal: 'add' | 'remove';
}

export interface PubkeySignal {
  pubkey: string;
  signal: 'add' | 'remove';
}

export interface DatetimeSignal {
  datetime: number; // Unix timestamp
  signal: 'add' | 'remove';
}

export interface RelaySignal {
  relays: string[];
  signal: 'add' | 'remove';
}

export type ExtractionSignal = EventIdSignal | PubkeySignal | DatetimeSignal | RelaySignal;

// Get socket for extraction field
function getSocketForField(field: ExtractionField): ClassicPreset.Socket {
  switch (field) {
    case 'eventId':
    case '#e':
      return eventIdSocket;
    case 'author':
    case '#p':
      return pubkeySocket;
    case 'created_at':
      return datetimeSocket;
    case '#r':
      return relaySocket;
  }
}

export class ExtractionNode extends ClassicPreset.Node {
  static readonly nodeType = 'Extraction';
  readonly nodeType = 'Extraction';
  width = 200;
  height: number | undefined = undefined;

  private extractionField: ExtractionField = 'eventId';
  private relayFilterType: RelayFilterType = 'all';

  // Input observable
  private input$: Observable<EventSignal> | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  // Output observables for each type
  private eventIdSubject = new Subject<EventIdSignal>();
  private pubkeySubject = new Subject<PubkeySignal>();
  private datetimeSubject = new Subject<DatetimeSignal>();
  private relaySubject = new Subject<RelaySignal>();

  public eventIdOutput$: Observable<EventIdSignal> = this.eventIdSubject.asObservable().pipe(share());
  public pubkeyOutput$: Observable<PubkeySignal> = this.pubkeySubject.asObservable().pipe(share());
  public datetimeOutput$: Observable<DatetimeSignal> = this.datetimeSubject.asObservable().pipe(share());
  public relayOutput$: Observable<RelaySignal> = this.relaySubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.extraction.title', 'Extraction'));

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Event'));
    this.addOutput('output', new ClassicPreset.Output(eventIdSocket, 'Value'));

    // Field selector
    this.addControl(
      'field',
      new SelectControl(
        this.extractionField,
        i18next.t('nodes.extraction.field', 'Field'),
        [
          { value: 'eventId', label: i18next.t('nodes.extraction.eventId', 'Event ID') },
          { value: 'author', label: i18next.t('nodes.extraction.author', 'Author (pubkey)') },
          { value: 'created_at', label: i18next.t('nodes.extraction.createdAt', 'Created At') },
          { value: '#e', label: '#e' },
          { value: '#p', label: '#p' },
          { value: '#r', label: '#r' },
        ],
        (value) => {
          this.extractionField = value as ExtractionField;
          this.updateOutputSocket();
          this.updateRelayFilterDisabled();
        }
      )
    );

    // Relay filter (only enabled when #r is selected)
    this.addControl(
      'relayFilter',
      new SelectControl(
        this.relayFilterType,
        i18next.t('nodes.extraction.relayFilter', 'Relay Filter'),
        [
          { value: 'all', label: i18next.t('nodes.extraction.relayAll', 'All') },
          { value: 'read', label: i18next.t('nodes.extraction.relayRead', 'With Read') },
          { value: 'write', label: i18next.t('nodes.extraction.relayWrite', 'With Write') },
          { value: 'readWrite', label: i18next.t('nodes.extraction.relayReadWrite', 'With Read and Write') },
        ],
        (value) => {
          this.relayFilterType = value as RelayFilterType;
        },
        this.extractionField !== '#r' // disabled when not #r
      )
    );
  }

  private updateOutputSocket(): void {
    this.removeOutput('output');
    this.addOutput('output', new ClassicPreset.Output(getSocketForField(this.extractionField), 'Value'));
  }

  private updateRelayFilterDisabled(): void {
    const relayFilterControl = this.controls['relayFilter'] as SelectControl;
    if (relayFilterControl) {
      relayFilterControl.disabled = this.extractionField !== '#r';
    }
  }

  getExtractionField(): ExtractionField {
    return this.extractionField;
  }

  getRelayFilterType(): RelayFilterType {
    return this.relayFilterType;
  }

  // Set input observable and subscribe
  setInput(input: Observable<EventSignal> | null): void {
    this.input$ = input;
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    // Cleanup existing subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    if (!this.input$) return;

    this.subscription = this.input$.subscribe({
      next: (eventSignal) => {
        this.extractAndEmit(eventSignal);
      },
    });
  }

  private extractAndEmit(eventSignal: EventSignal): void {
    const { event, signal } = eventSignal;

    switch (this.extractionField) {
      case 'eventId':
        this.eventIdSubject.next({ eventId: event.id, signal });
        break;

      case 'author':
        this.pubkeySubject.next({ pubkey: event.pubkey, signal });
        break;

      case 'created_at':
        this.datetimeSubject.next({ datetime: event.created_at, signal });
        break;

      case '#e':
        // Extract all #e tags
        for (const tag of event.tags) {
          if (tag[0] === 'e' && tag[1]) {
            this.eventIdSubject.next({ eventId: tag[1], signal });
          }
        }
        break;

      case '#p':
        // Extract all #p tags
        for (const tag of event.tags) {
          if (tag[0] === 'p' && tag[1]) {
            this.pubkeySubject.next({ pubkey: tag[1], signal });
          }
        }
        break;

      case '#r':
        // Extract #r tags with optional filtering
        const relays: string[] = [];
        for (const tag of event.tags) {
          if (tag[0] === 'r' && tag[1]) {
            const url = tag[1];
            const marker = tag[2]; // 'read', 'write', or undefined (both)

            let include = false;
            switch (this.relayFilterType) {
              case 'all':
                include = true;
                break;
              case 'read':
                include = !marker || marker === 'read';
                break;
              case 'write':
                include = !marker || marker === 'write';
                break;
              case 'readWrite':
                include = !marker; // Only include if no marker (means both read and write)
                break;
            }

            if (include) {
              relays.push(url);
            }
          }
        }
        if (relays.length > 0) {
          this.relaySubject.next({ relays, signal });
        }
        break;
    }
  }

  // Get the current output observable based on extraction field
  getOutput$(): Observable<ExtractionSignal> {
    switch (this.extractionField) {
      case 'eventId':
      case '#e':
        return this.eventIdOutput$;
      case 'author':
      case '#p':
        return this.pubkeyOutput$;
      case 'created_at':
        return this.datetimeOutput$;
      case '#r':
        return this.relayOutput$;
    }
  }

  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  serialize() {
    return {
      extractionField: this.extractionField,
      relayFilterType: this.relayFilterType,
    };
  }

  deserialize(data: { extractionField: ExtractionField; relayFilterType: RelayFilterType }) {
    this.extractionField = data.extractionField;
    this.relayFilterType = data.relayFilterType;

    // Update controls
    const fieldControl = this.controls['field'] as SelectControl;
    if (fieldControl) {
      fieldControl.value = this.extractionField;
    }

    const relayFilterControl = this.controls['relayFilter'] as SelectControl;
    if (relayFilterControl) {
      relayFilterControl.value = this.relayFilterType;
    }

    // Update output socket
    this.updateOutputSocket();
  }
}
