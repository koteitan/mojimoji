import { TimelineItem } from './TimelineItem';
import type { TimelineEvent } from '../../nostr/types';
import './Timeline.css';

interface TimelineProps {
  name: string;
  events: TimelineEvent[];
}

export function Timeline({ name, events }: TimelineProps) {
  return (
    <div className="timeline">
      <div className="timeline-header">
        <h3>{name}</h3>
      </div>
      <div className="timeline-events">
        {events.length === 0 ? (
          <div className="timeline-empty">No events</div>
        ) : (
          events.map((event) => (
            <TimelineItem key={event.event.id} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
