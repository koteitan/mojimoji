import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNpub, extractImageUrls, type TimelineEvent } from '../../nostr/types';
import './Timeline.css';

const DEFAULT_AVATAR = `${import.meta.env.BASE_URL}default-avatar.svg`;

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

export function TimelineItem({ event }: TimelineItemProps) {
  const { t } = useTranslation();
  const { event: nostrEvent, profile, contentWarning } = event;
  const isReaction = nostrEvent.kind === 7;
  const hasContentWarning = contentWarning !== undefined;

  const [revealed, setRevealed] = useState(false);

  // Show npub if no profile name available
  const displayName = profile?.display_name || profile?.name || formatNpub(nostrEvent.pubkey);
  const userName = profile?.name || formatNpub(nostrEvent.pubkey);

  const handleReveal = () => {
    setRevealed(true);
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
        {hasContentWarning && !revealed ? (
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
        ) : isReaction ? (
          <span className="timeline-item-reaction">{nostrEvent.content || '+'}</span>
        ) : (
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
        )}
      </div>
      <div className="timeline-item-time">
        {formatDate(nostrEvent.created_at)}
      </div>
    </div>
  );
}
