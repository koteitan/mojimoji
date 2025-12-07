import { ClassicPreset } from 'rete';
import { Observable, merge, share, Subject } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { SelectControl } from './controls';
import type { NostrEvent } from '../../../nostr/types';

export type OperatorType = 'AND' | 'OR' | 'A-B';

export class OperatorNode extends ClassicPreset.Node {
  width = 180;
  height = 160;

  private operator: OperatorType = 'AND';

  // Input observables (set by GraphEditor when connections change)
  private input1$: Observable<NostrEvent> | null = null;
  private input2$: Observable<NostrEvent> | null = null;

  // Output observable
  private outputSubject = new Subject<NostrEvent>();
  public output$: Observable<NostrEvent> = this.outputSubject.asObservable().pipe(share());

  // Track seen event IDs for AND/A-B operations
  private seenFromInput1 = new Set<string>();
  private seenFromInput2 = new Set<string>();

  // Subscriptions
  private subscriptions: { unsubscribe: () => void }[] = [];

  constructor() {
    super(i18next.t('nodes.operator.title'));

    this.addInput('input1', new ClassicPreset.Input(eventSocket, 'Input A'));
    this.addInput('input2', new ClassicPreset.Input(eventSocket, 'Input B'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    this.addControl(
      'operator',
      new SelectControl(
        this.operator,
        'Operation',
        [
          { value: 'AND', label: i18next.t('nodes.operator.and') + ' (A ∩ B)' },
          { value: 'OR', label: i18next.t('nodes.operator.or') + ' (A ∪ B)' },
          { value: 'A-B', label: i18next.t('nodes.operator.diff') },
        ],
        (value) => {
          this.operator = value as OperatorType;
        }
      )
    );
  }

  getOperator(): OperatorType {
    return this.operator;
  }

  serialize() {
    return {
      operator: this.operator,
    };
  }

  deserialize(data: { operator: OperatorType }) {
    this.operator = data.operator;

    const control = this.controls['operator'] as SelectControl;
    if (control) {
      control.value = this.operator;
    }
  }

  // Set input observables and rebuild the pipeline
  setInputs(input1: Observable<NostrEvent> | null, input2: Observable<NostrEvent> | null): void {
    this.input1$ = input1;
    this.input2$ = input2;
    this.rebuildPipeline();
  }

  // Rebuild the observable pipeline based on current operator
  private rebuildPipeline(): void {
    // Cleanup existing subscriptions
    this.stopSubscriptions();
    this.seenFromInput1.clear();
    this.seenFromInput2.clear();

    if (!this.input1$ && !this.input2$) return;

    switch (this.operator) {
      case 'OR':
        // OR: merge both streams
        if (this.input1$ && this.input2$) {
          const sub = merge(this.input1$, this.input2$).subscribe({
            next: (event) => this.outputSubject.next(event),
          });
          this.subscriptions.push(sub);
        } else if (this.input1$) {
          const sub = this.input1$.subscribe({
            next: (event) => this.outputSubject.next(event),
          });
          this.subscriptions.push(sub);
        } else if (this.input2$) {
          const sub = this.input2$.subscribe({
            next: (event) => this.outputSubject.next(event),
          });
          this.subscriptions.push(sub);
        }
        break;

      case 'AND':
        // AND: only emit events that appear in both streams
        if (this.input1$ && this.input2$) {
          const sub1 = this.input1$.subscribe({
            next: (event) => {
              if (this.seenFromInput2.has(event.id)) {
                this.outputSubject.next(event);
              } else {
                this.seenFromInput1.add(event.id);
              }
            },
          });
          const sub2 = this.input2$.subscribe({
            next: (event) => {
              if (this.seenFromInput1.has(event.id)) {
                this.outputSubject.next(event);
              } else {
                this.seenFromInput2.add(event.id);
              }
            },
          });
          this.subscriptions.push(sub1, sub2);
        }
        break;

      case 'A-B':
        // A-B: events from input1 that are NOT in input2
        if (this.input1$ && this.input2$) {
          const sub2 = this.input2$.subscribe({
            next: (event) => {
              this.seenFromInput2.add(event.id);
            },
          });
          const sub1 = this.input1$.subscribe({
            next: (event) => {
              if (!this.seenFromInput2.has(event.id)) {
                this.outputSubject.next(event);
              }
            },
          });
          this.subscriptions.push(sub1, sub2);
        } else if (this.input1$) {
          // If no input2, just pass through input1
          const sub = this.input1$.subscribe({
            next: (event) => this.outputSubject.next(event),
          });
          this.subscriptions.push(sub);
        }
        break;
    }
  }

  // Stop all subscriptions
  stopSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }
}
