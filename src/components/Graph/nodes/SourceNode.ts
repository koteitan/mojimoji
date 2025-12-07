import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { eventSocket } from './types';
import { TextAreaControl } from './controls';
import type { NostrEvent } from '../../../nostr/types';

// Type for the result of createRxForwardReq with emit method
type ForwardReq = ReturnType<typeof createRxForwardReq>;

export class SourceNode extends ClassicPreset.Node {
  width = 220;
  height = 200;

  private relayUrls: string[] = ['wss://relay.damus.io'];
  private filterJson: string = '{"kinds": [1], "limit": 20}';

  // RxJS Observable for output events
  private eventSubject = new Subject<NostrEvent>();
  private rxNostr: RxNostr | null = null;
  private rxReq: ForwardReq | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  // Shared observable that can be subscribed to by multiple downstream nodes
  public output$: Observable<NostrEvent> = this.eventSubject.asObservable().pipe(share());

  constructor() {
    super('Source');

    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));

    this.addControl(
      'relays',
      new TextAreaControl(
        this.relayUrls.join('\n'),
        'Relay URLs',
        'wss://relay.example.com',
        (value) => {
          this.relayUrls = value.split('\n').filter(url => url.trim());
        }
      )
    );

    this.addControl(
      'filter',
      new TextAreaControl(
        this.filterJson,
        'Filter (JSON)',
        '{"kinds": [1], "limit": 20}',
        (value) => {
          this.filterJson = value;
        }
      )
    );
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  getFilter(): Record<string, unknown> {
    try {
      return JSON.parse(this.filterJson);
    } catch {
      return { kinds: [1], limit: 20 };
    }
  }

  serialize() {
    return {
      relayUrls: this.relayUrls,
      filterJson: this.filterJson,
    };
  }

  deserialize(data: { relayUrls: string[]; filterJson: string }) {
    this.relayUrls = data.relayUrls;
    this.filterJson = data.filterJson;

    const relaysControl = this.controls['relays'] as TextAreaControl;
    if (relaysControl) {
      relaysControl.value = this.relayUrls.join('\n');
    }

    const filterControl = this.controls['filter'] as TextAreaControl;
    if (filterControl) {
      filterControl.value = this.filterJson;
    }
  }

  // Start the nostr subscription and emit events to the Subject
  startSubscription(): void {
    // Stop any existing subscription first
    this.stopSubscription();

    if (this.relayUrls.length === 0) return;

    this.rxNostr = createRxNostr({ verifier });
    this.rxNostr.setDefaultRelays(this.relayUrls);

    this.rxReq = createRxForwardReq();

    this.subscription = this.rxNostr.use(this.rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        this.eventSubject.next(event);
      },
      error: (err) => {
        console.error('SourceNode subscription error:', err);
      },
    });

    // Emit the filter to start receiving events
    const filter = this.getFilter();
    this.rxReq.emit(filter as { kinds?: number[]; limit?: number });
  }

  // Stop the nostr subscription
  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.rxNostr) {
      this.rxNostr.dispose();
      this.rxNostr = null;
    }
    this.rxReq = null;
  }

  // Check if subscription is active
  isSubscribed(): boolean {
    return this.subscription !== null;
  }
}
