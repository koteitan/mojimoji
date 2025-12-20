import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNpub, extractImageUrls, eventIdToNevent, type TimelineEvent, type Profile } from '../../nostr/types';
import './Timeline.css';

const DEFAULT_AVATAR = `${import.meta.env.BASE_URL}default-avatar.svg`;

// Parse profile from kind 0 event content
function parseProfileFromContent(content: string): Profile | null {
  try {
    return JSON.parse(content) as Profile;
  } catch {
    return null;
  }
}

interface TimelineItemProps {
  event: TimelineEvent;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

// Component for displaying an image with loading/error states
function ImagePreview({ url }: { url: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (error) {
    return null; // Don't show broken images
  }

  return (
    <div className="timeline-item-image-container">
      {loading && <div className="timeline-item-image-loading" />}
      <img
        className={`timeline-item-image ${loading ? 'loading' : ''}`}
        src={url}
        alt=""
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      />
    </div>
  );
}

// Component for content with images
function ContentWithImages({ content, revealed }: { content: string; revealed: boolean }) {
  const imageUrls = extractImageUrls(content);

  // Remove image URLs from text content for cleaner display
  let textContent = content;
  for (const url of imageUrls) {
    textContent = textContent.replace(url, '').trim();
  }

  // Clean up multiple spaces/newlines left after removing URLs
  textContent = textContent.replace(/\n\s*\n/g, '\n').trim();

  return (
    <>
      {textContent && <div className="timeline-item-text">{textContent}</div>}
      {revealed && imageUrls.length > 0 && (
        <div className="timeline-item-images">
          {imageUrls.map((url, index) => (
            <ImagePreview key={`${url}-${index}`} url={url} />
          ))}
        </div>
      )}
    </>
  );
}

// Render kind 0 (profile) event
function ProfileEventContent({ nostrEvent }: { nostrEvent: TimelineEvent['event'] }) {
  const eventProfile = parseProfileFromContent(nostrEvent.content);

  if (!eventProfile) {
    return <div className="timeline-item-text">{nostrEvent.content}</div>;
  }

  return (
    <div className="timeline-item-profile">
      <div className="timeline-item-profile-header">
        <img
          className="timeline-item-profile-picture"
          src={eventProfile.picture || DEFAULT_AVATAR}
          alt={eventProfile.name || 'avatar'}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.src.endsWith('default-avatar.svg')) {
              img.src = DEFAULT_AVATAR;
            }
          }}
        />
        <div className="timeline-item-profile-info">
          <div className="timeline-item-profile-name">
            {eventProfile.display_name || eventProfile.name || formatNpub(nostrEvent.pubkey)}
          </div>
          {eventProfile.name && (
            <div className="timeline-item-profile-username">@{eventProfile.name}</div>
          )}
          {eventProfile.nip05 && (
            <div className="timeline-item-profile-nip05">{eventProfile.nip05}</div>
          )}
        </div>
      </div>
      {eventProfile.about && (
        <div className="timeline-item-profile-about">{eventProfile.about}</div>
      )}
      <div className="timeline-item-profile-pubkey">
        {formatNpub(nostrEvent.pubkey)}
      </div>
    </div>
  );
}

// Render unknown kind event (show as event id)
function UnknownKindContent({ nostrEvent }: { nostrEvent: TimelineEvent['event'] }) {
  const nevent = eventIdToNevent(nostrEvent.id);

  return (
    <div className="timeline-item-unknown">
      <div className="timeline-item-unknown-kind">kind: {nostrEvent.kind}</div>
      <div className="timeline-item-unknown-id">{nevent}</div>
      {nostrEvent.content && (
        <div className="timeline-item-unknown-content">{nostrEvent.content.slice(0, 100)}...</div>
      )}
    </div>
  );
}

export function TimelineItem({ event }: TimelineItemProps) {
  const { t } = useTranslation();
  const { event: nostrEvent, profile, contentWarning } = event;
  const isProfile = nostrEvent.kind === 0;
  const isTextNote = nostrEvent.kind === 1;
  const isReaction = nostrEvent.kind === 7;
  const hasContentWarning = contentWarning !== undefined;

  const [revealed, setRevealed] = useState(false);

  // Show npub if no profile name available
  const displayName = profile?.display_name || profile?.name || formatNpub(nostrEvent.pubkey);
  const userName = profile?.name || formatNpub(nostrEvent.pubkey);

  const handleReveal = () => {
    setRevealed(true);
  };

  // Render content based on event kind
  const renderContent = () => {
    // Handle content warning
    if (hasContentWarning && !revealed) {
      return (
        <div className="timeline-item-cw">
          <div className="timeline-item-cw-label">
            <span className="timeline-item-cw-icon">⚠️</span>
            <span className="timeline-item-cw-text">
              {contentWarning
                ? t('timeline.contentWarningWithReason', { reason: contentWarning })
                : t('timeline.contentWarning')
              }
            </span>
          </div>
          <button
            className="timeline-item-cw-button"
            onClick={handleReveal}
          >
            {t('timeline.showContent')}
          </button>
        </div>
      );
    }

    // Kind 0: Profile
    if (isProfile) {
      return <ProfileEventContent nostrEvent={nostrEvent} />;
    }

    // Kind 1: Text note (default behavior)
    if (isTextNote) {
      return (
        <>
          <ContentWithImages content={nostrEvent.content} revealed={!hasContentWarning || revealed} />
          {hasContentWarning && revealed && (
            <button
              className="timeline-item-hide-link"
              onClick={() => setRevealed(false)}
            >
              {t('timeline.hideContent')}
            </button>
          )}
        </>
      );
    }

    // Kind 7: Reaction
    if (isReaction) {
      return <span className="timeline-item-reaction">{nostrEvent.content || '+'}</span>;
    }

    // Other kinds: Show as event id
    return <UnknownKindContent nostrEvent={nostrEvent} />;
  };

  return (
    <div className="timeline-item">
      <div className="timeline-item-header">
        <img
          className="timeline-item-icon"
          src={profile?.picture || DEFAULT_AVATAR}
          alt={profile?.name || 'avatar'}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.src.endsWith('default-avatar.svg')) {
              img.src = DEFAULT_AVATAR;
            }
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
        {renderContent()}
      </div>
      <div className="timeline-item-time">
        {formatDate(nostrEvent.created_at)}
      </div>
    </div>
  );
}
