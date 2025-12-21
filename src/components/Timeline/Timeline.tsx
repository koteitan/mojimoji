import { TimelineEventItemComponent, TimelineGenericItemComponent } from './TimelineItem';
import type { TimelineEvent, TimelineItem as TimelineItemData } from '../../nostr/types';
import './Timeline.css';

interface TimelineProps {
  name: string;
  events: TimelineEvent[];
  items?: TimelineItemData[];
  dataType?: string;
}

export function Timeline({ name, events, items, dataType }: TimelineProps) {
  // Use new items array if provided, otherwise fall back to events
  const useNewFormat = items !== undefined && dataType !== 'event';

  return (
    <div className="timeline">
      <div className="timeline-header">
        <h3>{name}</h3>
      </div>
      <div className="timeline-events">
        {useNewFormat ? (
          // New format: use items array for non-event types
          items!.length === 0 ? (
            <div className="timeline-empty">No items</div>
          ) : (
            items!.map((item) => (
              <TimelineGenericItemComponent key={item.id} item={item} />
            ))
          )
        ) : (
          // Old format: use events array for event type
          events.length === 0 ? (
            <div className="timeline-empty">No events</div>
          ) : (
            events.map((event) => (
              <TimelineEventItemComponent key={event.event.id} event={event} />
            ))
          )
        )}
      </div>
    </div>
  );
}
