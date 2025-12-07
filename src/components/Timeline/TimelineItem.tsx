import { formatNpub, type TimelineEvent } from '../../nostr/types';
import './Timeline.css';

interface TimelineItemProps {
  event: TimelineEvent;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

export function TimelineItem({ event }: TimelineItemProps) {
  const { event: nostrEvent, profile } = event;
  const isReaction = nostrEvent.kind === 7;

  // Show npub if no profile name available
  const displayName = profile?.display_name || profile?.name || formatNpub(nostrEvent.pubkey);
  const userName = profile?.name || formatNpub(nostrEvent.pubkey);

  return (
    <div className="timeline-item">
      <div className="timeline-item-header">
        <img
          className="timeline-item-icon"
          src={profile?.picture || '/default-avatar.svg'}
          alt={profile?.name || 'avatar'}
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/default-avatar.svg';
          }}
        />
        <div className="timeline-item-names">
          <span className="timeline-item-display-name">
            {displayName}
          </span>
          <span className="timeline-item-name">
            @{userName}
          </span>
        </div>
      </div>
      <div className="timeline-item-content">
        {isReaction ? (
          <span className="timeline-item-reaction">{nostrEvent.content || '+'}</span>
        ) : (
          nostrEvent.content
        )}
      </div>
      <div className="timeline-item-time">
        {formatDate(nostrEvent.created_at)}
      </div>
    </div>
  );
}
