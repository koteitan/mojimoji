import { useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatNpub,
  extractImageUrls,
  eventIdToNevent,
  pubkeyToNpub,
  detectEventReferences,
  type TimelineEvent,
  type TimelineItem as TimelineItemData,
  type TimelineReactionGroupItem,
  type Profile,
  type NostrEvent,
  type EventReferenceType,
  type ETagMarker,
} from '../../nostr/types';
import { EventFetcher } from '../../nostr/EventFetcher';
import { getCachedProfile } from '../../nostr/profileCache';
import { GlobalProfileFetcher } from '../../nostr/ProfileFetcher';
import './Timeline.css';

const DEFAULT_AVATAR = `${import.meta.env.BASE_URL}mojimoji-icon.png`;

// Pattern definitions for content parsing
const PATTERNS = {
  // URL pattern (https:// only, excluding image URLs which are handled separately)
  url: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
  // Nostr entities: nevent, npub, nprofile, note, naddr
  nostrEntity: /nostr:(nevent1[a-z0-9]+|npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|naddr1[a-z0-9]+)/gi,
  // Hashtags: # followed by 2+ alphanumeric/unicode characters (not just numbers)
  hashtag: /#([^\s#]+)/g,
  // Image URL pattern (to exclude from regular URL linking)
  imageUrl: /https?:\/\/[^\s<>"{}|\\^`\[\]]+\.(jpg|jpeg|gif|png|webp)(\?[^\s<>"{}|\\^`\[\]]*)?/gi,
};

// Parse content and return React elements with links
function parseContentWithLinks(content: string): ReactNode[] {
  // Get image URLs to exclude them from regular linking
  const imageUrls = new Set<string>();
  let match;
  while ((match = PATTERNS.imageUrl.exec(content)) !== null) {
    imageUrls.add(match[0]);
  }

  // Combined pattern for all link types
  const combinedPattern = new RegExp(
    `(${PATTERNS.nostrEntity.source})|(${PATTERNS.url.source})|(${PATTERNS.hashtag.source})`,
    'gi'
  );

  const result: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // Reset regex state
  combinedPattern.lastIndex = 0;

  while ((match = combinedPattern.exec(content)) !== null) {
    const matchedText = match[0];
    const matchIndex = match.index;

    // Add text before this match
    if (matchIndex > lastIndex) {
      result.push(content.slice(lastIndex, matchIndex));
    }

    // Determine match type and create appropriate link
    // Groups: match[1]=nostr full, match[2]=nostr inner, match[3]=url, match[4]=hashtag full, match[5]=hashtag content
    if (match[1]) {
      // Nostr entity (nostr:nevent1..., nostr:npub1..., etc.)
      const entity = match[1].replace(/^nostr:/i, '');
      const href = `https://nostter.app/${entity}`;
      const displayText = entity.length > 20 ? `${entity.slice(0, 10)}...${entity.slice(-8)}` : entity;
      result.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="timeline-link timeline-link-nostr"
        >
          {displayText}
        </a>
      );
    } else if (match[3] && !imageUrls.has(matchedText)) {
      // Regular URL (not an image)
      result.push(
        <a
          key={key++}
          href={matchedText}
          target="_blank"
          rel="noopener noreferrer"
          className="timeline-link timeline-link-url"
        >
          {matchedText}
        </a>
      );
    } else if (match[4]) {
      // Hashtag
      const tag = match[5]; // The captured group without #
      // Only link if 2+ characters and not purely numeric
      if (tag && tag.length >= 2 && !/^\d+$/.test(tag)) {
        const href = `https://nostter.app/search?q=${encodeURIComponent('#' + tag)}`;
        result.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="timeline-link timeline-link-hashtag"
          >
            #{tag}
          </a>
        );
      } else {
        // Not a valid hashtag, keep as text
        result.push(matchedText);
      }
    } else {
      // Image URL or other - keep as text (will be rendered as image separately)
      result.push(matchedText);
    }

    lastIndex = matchIndex + matchedText.length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    result.push(content.slice(lastIndex));
  }

  return result.length > 0 ? result : [content];
}

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

// Component for content with images and links
function ContentWithImages({ content, revealed }: { content: string; revealed: boolean }) {
  const imageUrls = extractImageUrls(content);

  // Remove image URLs from text content for cleaner display
  let textContent = content;
  for (const url of imageUrls) {
    textContent = textContent.replace(url, '').trim();
  }

  // Clean up multiple spaces/newlines left after removing URLs
  textContent = textContent.replace(/\n\s*\n/g, '\n').trim();

  // Parse content to add links (URLs, nostr entities, hashtags)
  const parsedContent = textContent ? parseContentWithLinks(textContent) : null;

  return (
    <>
      {parsedContent && <div className="timeline-item-text">{parsedContent}</div>}
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

// Referenced event data with marker
interface ReferencedEventData {
  eventId: string;
  event: NostrEvent | null;
  profile: Profile | undefined;
  marker?: ETagMarker;
}

// Hook to fetch multiple referenced events (for NIP-10 markers: root → reply → mention)
function useReferencedEvents(event: NostrEvent): {
  referenceType: EventReferenceType | null;
  referencedEvents: ReferencedEventData[];
  loading: boolean;
} {
  const [referencedEvents, setReferencedEvents] = useState<ReferencedEventData[]>([]);
  const [loading, setLoading] = useState(false);

  const references = detectEventReferences(event);

  useEffect(() => {
    if (references.length === 0) return;

    setLoading(true);

    // Initialize with event IDs and markers
    const initialData: ReferencedEventData[] = references.map(ref => ({
      eventId: ref.eventId,
      event: null,
      profile: undefined,
      marker: ref.marker,
    }));
    setReferencedEvents(initialData);

    // Fetch each referenced event
    let completedCount = 0;
    references.forEach((ref, index) => {
      EventFetcher.queueRequest(ref.eventId, (fetchedEvent) => {
        completedCount++;
        if (fetchedEvent) {
          setReferencedEvents(prev => {
            const newData = [...prev];
            newData[index] = {
              ...newData[index],
              event: fetchedEvent,
            };
            return newData;
          });
          // Try to get cached profile
          const cached = getCachedProfile(fetchedEvent.pubkey);
          if (cached) {
            setReferencedEvents(prev => {
              const newData = [...prev];
              newData[index] = {
                ...newData[index],
                profile: cached,
              };
              return newData;
            });
          } else {
            GlobalProfileFetcher.queueRequest(fetchedEvent.pubkey);
            // Check again after a delay
            setTimeout(() => {
              const profile = getCachedProfile(fetchedEvent.pubkey);
              if (profile) {
                setReferencedEvents(prev => {
                  const newData = [...prev];
                  newData[index] = {
                    ...newData[index],
                    profile,
                  };
                  return newData;
                });
              }
            }, 2000);
          }
        }
        if (completedCount === references.length) {
          setLoading(false);
        }
      });
    });
  }, [references.map(r => r.eventId).join(',')]);

  return {
    referenceType: references.length > 0 ? references[0].type : null,
    referencedEvents,
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

  // Fetch referenced events for quote/reply/repost/reaction (supports multiple references)
  const { referenceType, referencedEvents, loading: refLoading } = useReferencedEvents(nostrEvent);

  // Show npub if no profile name available
  const displayName = profile?.display_name || profile?.name || formatNpub(nostrEvent.pubkey);
  const userName = profile?.name || formatNpub(nostrEvent.pubkey);

  const handleReveal = () => {
    setRevealed(true);
  };

  // Render embedded event component (multiple events in series: root → reply → mention)
  const renderEmbeddedEvents = () => {
    if (refLoading && referencedEvents.length === 0) {
      return <div className="timeline-item-embedded-loading">Loading...</div>;
    }
    if (referencedEvents.length === 0) {
      return null;
    }
    return (
      <div className="timeline-item-embedded-series">
        {referencedEvents.map((refData) => (
          <div key={refData.eventId} className="timeline-item-embedded-wrapper">
            {refData.marker && (
              <div className="timeline-item-embedded-marker">{refData.marker}</div>
            )}
            {refData.event ? (
              <EmbeddedEventComponent event={refData.event} profile={refData.profile} />
            ) : (
              <div className="timeline-item-embedded-loading">Loading...</div>
            )}
          </div>
        ))}
      </div>
    );
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
      return renderEmbeddedEvents();
    }

    // Kind 1: Text note - handle quote and reply layouts
    if (isTextNote) {
      // Reply: embedded event first, then content
      if (referenceType === 'reply') {
        return (
          <>
            {renderEmbeddedEvents()}
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
          {referenceType === 'quote' && renderEmbeddedEvents()}
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
          {renderEmbeddedEvents()}
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
