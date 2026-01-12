import { TimelineGenericItemComponent } from './TimelineItem';
import type { TimelineItem as TimelineItemData, NostrEvent, Profile } from '../../nostr/types';
import './Timeline.css';

interface TimelineProps {
  name: string;
  items: TimelineItemData[];
  index: number;
  isLast: boolean;
  onSwap?: (index: number) => void;
  swapDirection?: 'left' | 'right' | null;
  onReply?: (event: NostrEvent, profile?: Profile) => void;
}

export function Timeline({ name, items, index, isLast, onSwap, swapDirection, onReply }: TimelineProps) {
  const swapClass = swapDirection ? `swapping-${swapDirection}` : '';
  const isFirst = index === 0;
  return (
    <div className={`timeline ${swapClass}`}>
      <div className="timeline-header">
        <h3>{name}</h3>
        {onSwap && (
          <div className="timeline-swap-buttons">
            {!isFirst && (
              <button
                className="timeline-swap-button"
                onClick={() => onSwap(index - 1)}
                title="Swap with previous timeline"
              >
                ◀
              </button>
            )}
            {!isLast && (
              <button
                className="timeline-swap-button"
                onClick={() => onSwap(index)}
                title="Swap with next timeline"
              >
                ▶
              </button>
            )}
          </div>
        )}
      </div>
      <div className="timeline-events">
        {items.length === 0 ? (
          <div className="timeline-empty">No items</div>
        ) : (
          items.map((item) => (
            <TimelineGenericItemComponent key={item.id} item={item} onReply={onReply} />
          ))
        )}
      </div>
    </div>
  );
}
