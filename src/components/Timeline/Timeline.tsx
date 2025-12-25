import { TimelineGenericItemComponent } from './TimelineItem';
import type { TimelineItem as TimelineItemData } from '../../nostr/types';
import './Timeline.css';

interface TimelineProps {
  name: string;
  items: TimelineItemData[];
}

export function Timeline({ name, items }: TimelineProps) {
  return (
    <div className="timeline">
      <div className="timeline-header">
        <h3>{name}</h3>
      </div>
      <div className="timeline-events">
        {items.length === 0 ? (
          <div className="timeline-empty">No items</div>
        ) : (
          items.map((item) => (
            <TimelineGenericItemComponent key={item.id} item={item} />
          ))
        )}
      </div>
    </div>
  );
}
