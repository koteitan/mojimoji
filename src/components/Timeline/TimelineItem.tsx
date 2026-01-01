import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatNpub,
  extractImageUrls,
  eventIdToNevent,
  pubkeyToNpub,
  detectEventReference,
  type TimelineEvent,
  type TimelineItem as TimelineItemData,
  type TimelineReactionGroupItem,
  type Profile,
  type NostrEvent,
  type EventReferenceType,
} from '../../nostr/types';
import { EventFetcher } from '../../nostr/EventFetcher';
import { getCachedProfile } from '../../nostr/profileCache';
import { GlobalProfileFetcher } from '../../nostr/ProfileFetcher';
import './Timeline.css';

const DEFAULT_AVATAR = `${import.meta.env.BASE_URL}mojimoji-icon.png`;

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

// Component for embedded/referenced event (quote, reply, repost, reaction target)
interface EmbeddedEventProps {
  event: NostrEvent;
  profile?: Profile;
}

function EmbeddedEventComponent({ event, profile }: EmbeddedEventProps) {
  const displayName = profile?.display_name || profile?.name || formatNpub(event.pubkey);
  const userName = profile?.name || formatNpub(event.pubkey);

  return (
    <div className="timeline-item-embedded">
      <div className="timeline-item-embedded-header">
        <img
          className="timeline-item-embedded-icon"
          src={profile?.picture || DEFAULT_AVATAR}
          alt={profile?.name || 'avatar'}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.src.endsWith('mojimoji-icon.png')) {
              img.src = DEFAULT_AVATAR;
            }
          }}
        />
        <div className="timeline-item-embedded-names">
          <span className="timeline-item-embedded-display-name">{displayName}</span>
          <span className="timeline-item-embedded-name">@{userName}</span>
        </div>
      </div>
      <div className="timeline-item-embedded-content">
        <ContentWithImages content={event.content} revealed={true} />
      </div>
      <div className="timeline-item-embedded-time">
        {formatDate(event.created_at)}
      </div>
    </div>
  );
}

// Hook to fetch referenced event
function useReferencedEvent(event: NostrEvent): {
  referenceType: EventReferenceType | null;
  referencedEvent: NostrEvent | null;
  referencedProfile: Profile | undefined;
  loading: boolean;
} {
  const [referencedEvent, setReferencedEvent] = useState<NostrEvent | null>(null);
  const [referencedProfile, setReferencedProfile] = useState<Profile | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const reference = detectEventReference(event);

  useEffect(() => {
    if (!reference) return;

    setLoading(true);

    EventFetcher.queueRequest(reference.eventId, (fetchedEvent) => {
      setLoading(false);
      if (fetchedEvent) {
        setReferencedEvent(fetchedEvent);
        // Try to get cached profile, queue fetch if not available
        const cached = getCachedProfile(fetchedEvent.pubkey);
        if (cached) {
          setReferencedProfile(cached);
        } else {
          GlobalProfileFetcher.queueRequest(fetchedEvent.pubkey);
          // Check again after a delay
          setTimeout(() => {
            const profile = getCachedProfile(fetchedEvent.pubkey);
            if (profile) {
              setReferencedProfile(profile);
            }
          }, 2000);
        }
      }
    });
  }, [reference?.eventId]);

  return {
    referenceType: reference?.type || null,
    referencedEvent,
    referencedProfile,
    loading,
  };
}

// Component for grouped reactions to a single target event
interface ReactionGroupItemProps {
  item: TimelineReactionGroupItem;
}

export function ReactionGroupItemComponent({ item }: ReactionGroupItemProps) {
  const { targetEvent, targetProfile, reactions } = item;

  return (
    <div className="timeline-item timeline-item-reaction-group">
      <div className="reaction-group-reactions">
        {reactions.map((reactionGroup, idx) => (
          <div key={idx} className="reaction-group-row">
            <span className="reaction-group-emoji">{reactionGroup.content}</span>
            <div className="reaction-group-authors">
              {reactionGroup.authors.map((author, authorIdx) => (
                <img
                  key={authorIdx}
                  className="reaction-group-author-icon"
                  src={author.profile?.picture || DEFAULT_AVATAR}
                  alt={author.profile?.name || formatNpub(author.pubkey)}
                  title={author.profile?.display_name || author.profile?.name || formatNpub(author.pubkey)}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    if (!img.src.endsWith('mojimoji-icon.png')) {
                      img.src = DEFAULT_AVATAR;
                    }
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {targetEvent ? (
        <EmbeddedEventComponent event={targetEvent} profile={targetProfile} />
      ) : (
        <div className="timeline-item-embedded-loading">Loading target event...</div>
      )}
    </div>
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

// Event type timeline item (original)
export function TimelineEventItemComponent({ event }: TimelineItemProps) {
  const { t } = useTranslation();
  const { event: nostrEvent, profile, contentWarning } = event;
  const isProfile = nostrEvent.kind === 0;
  const isTextNote = nostrEvent.kind === 1;
  const isRepost = nostrEvent.kind === 6;
  const isReaction = nostrEvent.kind === 7;
  const hasContentWarning = contentWarning !== undefined;

  const [revealed, setRevealed] = useState(false);

  // Fetch referenced event for quote/reply/repost/reaction
  const { referenceType, referencedEvent, referencedProfile, loading: refLoading } = useReferencedEvent(nostrEvent);

  // Show npub if no profile name available
  const displayName = profile?.display_name || profile?.name || formatNpub(nostrEvent.pubkey);
  const userName = profile?.name || formatNpub(nostrEvent.pubkey);

  const handleReveal = () => {
    setRevealed(true);
  };

  // Render embedded event component
  const renderEmbeddedEvent = () => {
    if (refLoading) {
      return <div className="timeline-item-embedded-loading">Loading...</div>;
    }
    if (!referencedEvent) {
      return null;
    }
    return <EmbeddedEventComponent event={referencedEvent} profile={referencedProfile} />;
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

    // Kind 6: Repost - show only embedded event
    if (isRepost) {
      return renderEmbeddedEvent();
    }

    // Kind 1: Text note - handle quote and reply layouts
    if (isTextNote) {
      // Reply: embedded event first, then content
      if (referenceType === 'reply') {
        return (
          <>
            {renderEmbeddedEvent()}
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
      // Quote (and default): content first, then embedded event
      return (
        <>
          <ContentWithImages content={nostrEvent.content} revealed={!hasContentWarning || revealed} />
          {referenceType === 'quote' && renderEmbeddedEvent()}
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

    // Kind 7: Reaction - content first, then embedded event
    if (isReaction) {
      return (
        <>
          <span className="timeline-item-reaction">{nostrEvent.content || '+'}</span>
          {renderEmbeddedEvent()}
        </>
      );
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

// Format datetime as ISO 8601
function formatDateISO(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

// Generic timeline item component for non-event types
interface TimelineGenericItemProps {
  item: TimelineItemData;
}

export function TimelineGenericItemComponent({ item }: TimelineGenericItemProps) {
  switch (item.type) {
    case 'event':
      // Event type should use TimelineEventItemComponent
      return (
        <TimelineEventItemComponent
          event={{
            event: item.event,
            profile: item.profile,
            contentWarning: item.contentWarning,
          }}
        />
      );

    case 'eventId':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-eventid">
              {eventIdToNevent(item.eventId)}
            </div>
          </div>
        </div>
      );

    case 'pubkey':
      return (
        <div className="timeline-item">
          <div className="timeline-item-header">
            <img
              className="timeline-item-icon"
              src={item.profile?.picture || DEFAULT_AVATAR}
              alt={item.profile?.name || 'avatar'}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (!img.src.endsWith('default-avatar.svg')) {
                  img.src = DEFAULT_AVATAR;
                }
              }}
            />
            <div className="timeline-item-names">
              <span className="timeline-item-display-name">
                {item.profile?.display_name || item.profile?.name || formatNpub(item.pubkey)}
              </span>
              <span className="timeline-item-name">
                @{item.profile?.name || formatNpub(item.pubkey)}
              </span>
            </div>
          </div>
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-pubkey">
              {pubkeyToNpub(item.pubkey)}
            </div>
          </div>
        </div>
      );

    case 'datetime':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-datetime">
              {formatDateISO(item.datetime)}
            </div>
          </div>
        </div>
      );

    case 'relay':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-relay">
              {item.relays.map((url, index) => (
                <div key={index} className="timeline-item-relay-url">{url}</div>
              ))}
            </div>
          </div>
        </div>
      );

    case 'integer':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-integer">
              {item.value}
            </div>
          </div>
        </div>
      );

    case 'flag':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-flag">
              {item.flag ? '1 (true)' : '0 (false)'}
            </div>
          </div>
        </div>
      );

    case 'relayStatus':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-relaystatus">
              {item.status}
            </div>
          </div>
        </div>
      );

    case 'complete':
      return (
        <div className="timeline-item timeline-item-simple">
          <div className="timeline-item-content">
            <div className="timeline-item-value timeline-item-complete">
              ✓ complete
            </div>
          </div>
        </div>
      );

    case 'reactionGroup':
      return <ReactionGroupItemComponent item={item} />;

    default:
      return null;
  }
}

// Export alias for backward compatibility
export const TimelineItem = TimelineEventItemComponent;
