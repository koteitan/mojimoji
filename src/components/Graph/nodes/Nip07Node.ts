import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import i18next from 'i18next';
import { pubkeySocket } from './types';
import { isNip07Available, getPubkey } from '../../../nostr/nip07';

// Signal type for pubkey output
export interface PubkeySignal {
  pubkey: string;
}

export class Nip07Node extends ClassicPreset.Node {
  static readonly nodeType = 'Nip07';
  readonly nodeType = 'Nip07';
  width = 180;
  height: number | undefined = undefined;

  private pubkey: string | null = null;
  private error: string | null = null;

  // Output observable
  private outputSubject = new Subject<PubkeySignal>();
  public output$: Observable<PubkeySignal> = this.outputSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.nip07.title', 'NIP-07'));

    this.addOutput('output', new ClassicPreset.Output(pubkeySocket, 'Pubkey'));

    // Try to get pubkey on construction
    this.fetchPubkey();
  }

  private async fetchPubkey(): Promise<void> {
    if (!isNip07Available()) {
      this.error = i18next.t('nodes.nip07.notAvailable', 'NIP-07 extension not available');
      this.pubkey = null;
      return;
    }

    try {
      this.pubkey = await getPubkey();
      this.error = null;
      this.emitPubkey();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Unknown error';
      this.pubkey = null;
    }
  }

  emitPubkey(): void {
    if (this.pubkey) {
      this.outputSubject.next({ pubkey: this.pubkey });
    }
  }

  getPubkey(): string | null {
    return this.pubkey;
  }

  getError(): string | null {
    return this.error;
  }

  isAvailable(): boolean {
    return isNip07Available();
  }

  // Refresh pubkey (in case extension was loaded after page load)
  async refresh(): Promise<void> {
    await this.fetchPubkey();
  }

  serialize() {
    // No persistent state needed - pubkey is fetched from extension
    return {};
  }

  deserialize(_data: Record<string, unknown>) {
    // Re-fetch pubkey on load
    this.fetchPubkey();
  }
}
