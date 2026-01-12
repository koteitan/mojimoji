import { useState, useEffect, useRef, type ReactNode } from 'react';
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
import {
  isEventReacted,
  isEventReposted,
  sendReaction,
  sendRepost,
} from '../../nostr/eventActions';
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
  // YouTube URL patterns
  youtubeShort: /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+)(\?[^\s]*)?/gi,
  youtubeLong: /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)([^\s]*)?/gi,
  // X/Twitter URL patterns
  twitter: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)(\?[^\s]*)?/gi,
};

// Extract YouTube video ID from URL
function extractYouTubeVideoId(url: string): string | null {
  // youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
  if (shortMatch) return shortMatch[1];

  // youtube.com/watch?v=VIDEO_ID
  const longMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/i);
  if (longMatch) return longMatch[1];

  // youtube.com/shorts/VIDEO_ID
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/i);
  if (shortsMatch) return shortsMatch[1];

  return null;
}

// Check if URL is a YouTube URL
function isYouTubeUrl(url: string): boolean {
  return /youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/shorts\//i.test(url);
}

// Check if URL is a Twitter/X URL
function isTwitterUrl(url: string): boolean {
  return /(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/i.test(url);
}

// Convert image URL to thumbnail URL based on service
function convertToThumbnailUrl(url: string): string {
  // Imgur: add 'l' suffix before extension for large thumbnail
  if (/i\.imgur\.com\/([a-zA-Z0-9]+)\.(jpg|jpeg|png|gif|webp)/i.test(url)) {
    return url.replace(/\.([a-zA-Z]+)(\?.*)?$/, 'l.$1$2');
  }

  // Gyazo: use thumb.gyazo.com with 640px width
  const gyazoMatch = url.match(/i\.gyazo\.com\/([a-f0-9]+)\.(png|jpg|jpeg|gif)/i);
  if (gyazoMatch) {
    return `https://thumb.gyazo.com/thumb/640/${gyazoMatch[1]}.${gyazoMatch[2]}`;
  }

  // nostr.build: use resp/240p path for thumbnail
  const nostrBuildMatch = url.match(/i\.nostr\.build\/([^\s?]+)/i);
  if (nostrBuildMatch) {
    return `https://i.nostr.build/resp/240p/${nostrBuildMatch[1]}`;
  }

  // Twitter media: add format and size params
  if (/pbs\.twimg\.com\/media\//i.test(url)) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}format=jpg&name=small`;
  }

  // Discord: add size params
  if (/media\.discordapp\.net\/attachments\//i.test(url)) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}format=webp&width=320&height=320`;
  }

  // No conversion needed
  return url;
}

// Extract all YouTube URLs from content
function extractYouTubeUrls(content: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  let match;
  while ((match = urlPattern.exec(content)) !== null) {
    if (isYouTubeUrl(match[0])) {
      urls.push(match[0]);
    }
  }
  return urls;
}

// Extract all Twitter/X URLs from content
function extractTwitterUrls(content: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  let match;
  while ((match = urlPattern.exec(content)) !== null) {
    if (isTwitterUrl(match[0])) {
      urls.push(match[0]);
    }
  }
  return urls;
}

// Check if URL is an image URL
function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|gif|png|webp)(\?[^\s]*)?$/i.test(url);
}

// Extract general URLs (not YouTube, Twitter, or image)
function extractOgpUrls(content: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  let match;
  while ((match = urlPattern.exec(content)) !== null) {
    const url = match[0];
    if (!isYouTubeUrl(url) && !isTwitterUrl(url) && !isImageUrl(url)) {
      urls.push(url);
    }
  }
  return urls;
}

// OGP content type
interface OgpContent {
  url: string;
  title: string;
  description: string;
  image: string;
}

// Parse OGP from HTML text
function parseOgp(html: string, urlString: string): OgpContent | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const props: { [key: string]: string } = {};

  doc.head.querySelectorAll('meta').forEach((m) => {
    const property = m.getAttribute('property') || m.getAttribute('name');
    const content = m.getAttribute('content');
    if (property && content) {
      props[property] = content;
    }
  });

  const image = props['og:image'] || props['twitter:image'];
  const title = props['og:title'] || props['twitter:title'] || doc.title;
  const url = props['og:url'] || urlString;
  const description = props['og:description'] || props['twitter:description'] || '';

  if (title) {
    return { title, description, image: image || '', url };
  }
  return null;
}

// Fetch OGP content via CORS proxy
async function fetchOgpContent(urlString: string): Promise<OgpContent | null> {
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(urlString)}`;
    const res = await fetch(proxyUrl, {
      mode: 'cors',
      headers: { Accept: 'text/html' },
      credentials: 'omit',
    });
    const text = await res.text();
    return parseOgp(text, urlString);
  } catch (err) {
    console.error(`Failed to fetch OGP for ${urlString}`, err);
    return null;
  }
}

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
  onReply?: (event: NostrEvent, profile?: Profile) => void;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

// Component for displaying an image with loading/error states (uses thumbnail URL)
function ImagePreview({ url }: { url: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Convert to thumbnail URL for display
  const thumbnailUrl = convertToThumbnailUrl(url);

  if (error) {
    return null; // Don't show broken images
  }

  return (
    <div className="timeline-item-image-container">
      {loading && <div className="timeline-item-image-loading" />}
      <img
        className={`timeline-item-image ${loading ? 'loading' : ''}`}
        src={thumbnailUrl}
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

// Component for YouTube embed
function YouTubeEmbed({ url }: { url: string }) {
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="timeline-link timeline-link-url">
        {url}
      </a>
    );
  }

  return (
    <div className="timeline-embed-youtube">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}`}
        title="YouTube video"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

// Convert x.com URL to twitter.com for widget compatibility
function toTwitterUrl(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (url.host === 'x.com' || url.host === 'www.x.com') {
      url.host = 'twitter.com';
    }
    return url.href;
  } catch {
    return urlString;
  }
}

// Component for Twitter/X embed (uses official Twitter widget)
function TwitterEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (containerRef.current && window.twttr?.widgets) {
      window.twttr.widgets.load(containerRef.current);
      setLoaded(true);
    }
  }, [url]);

  const twitterUrl = toTwitterUrl(url);

  return (
    <div ref={containerRef} className="timeline-embed-twitter-container">
      <blockquote className="twitter-tweet" data-theme="dark" data-chrome="transparent nofooter">
        <a href={twitterUrl}>{loaded ? '' : 'Loading tweet...'}</a>
      </blockquote>
    </div>
  );
}

// Component for OGP link preview card
function OgpEmbed({ url }: { url: string }) {
  const [ogp, setOgp] = useState<OgpContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    fetchOgpContent(url).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result) {
        setOgp(result);
      } else {
        setError(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Show simple link while loading or on error
  if (loading || error || !ogp) {
    return null; // URL is already shown as link in text
  }

  // Get hostname for display
  let hostname = '';
  try {
    hostname = new URL(ogp.url).hostname;
  } catch {
    hostname = url;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="timeline-embed-ogp"
    >
      {ogp.image && (
        <div className="timeline-embed-ogp-image">
          <img src={ogp.image} alt={ogp.title} loading="lazy" />
        </div>
      )}
      <div className="timeline-embed-ogp-content">
        <div className="timeline-embed-ogp-host">{hostname}</div>
        <div className="timeline-embed-ogp-title">{ogp.title}</div>
        {ogp.description && (
          <div className="timeline-embed-ogp-description">{ogp.description}</div>
        )}
      </div>
    </a>
  );
}

// Component for content with images, links, and embeds
function ContentWithImages({ content, revealed }: { content: string; revealed: boolean }) {
  const imageUrls = extractImageUrls(content);
  const youtubeUrls = extractYouTubeUrls(content);
  const twitterUrls = extractTwitterUrls(content);
  const ogpUrls = extractOgpUrls(content);

  // Remove image, YouTube, and Twitter URLs from text content for cleaner display
  // OGP URLs are kept as links in text, but also shown as cards
  let textContent = content;
  for (const url of [...imageUrls, ...youtubeUrls, ...twitterUrls]) {
    textContent = textContent.replace(url, '').trim();
  }

  // Clean up multiple spaces/newlines left after removing URLs
  textContent = textContent.replace(/\n\s*\n/g, '\n').trim();

  // Parse content to add links (URLs, nostr entities, hashtags)
  const parsedContent = textContent ? parseContentWithLinks(textContent) : null;

  return (
    <>
      {parsedContent && <div className="timeline-item-text">{parsedContent}</div>}
      {revealed && youtubeUrls.length > 0 && (
        <div className="timeline-item-embeds">
          {youtubeUrls.map((url, index) => (
            <YouTubeEmbed key={`yt-${index}`} url={url} />
          ))}
        </div>
      )}
      {revealed && twitterUrls.length > 0 && (
        <div className="timeline-item-embeds">
          {twitterUrls.map((url, index) => (
            <TwitterEmbed key={`tw-${index}`} url={url} />
          ))}
        </div>
      )}
      {revealed && ogpUrls.length > 0 && (
        <div className="timeline-item-embeds">
          {ogpUrls.map((url, index) => (
            <OgpEmbed key={`ogp-${index}`} url={url} />
          ))}
        </div>
      )}
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
        <a
          href={`https://nostter.app/${pubkeyToNpub(event.pubkey)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
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
        </a>
        <div className="timeline-item-embedded-names">
          <a
            href={`https://nostter.app/${pubkeyToNpub(event.pubkey)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="timeline-link-author"
          >
            <span className="timeline-item-embedded-display-name">{displayName}</span>
            <span className="timeline-item-embedded-name">@{userName}</span>
          </a>
        </div>
      </div>
      <div className="timeline-item-embedded-content">
        <ContentWithImages content={event.content} revealed={true} />
      </div>
      <div className="timeline-item-embedded-time">
        <a
          href={`https://nostter.app/${eventIdToNevent(event.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="timeline-link-time"
        >
          {formatDate(event.created_at)}
        </a>
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
                <a
                  key={authorIdx}
                  href={`https://nostter.app/${pubkeyToNpub(author.pubkey)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
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
                </a>
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
export function TimelineEventItemComponent({ event, onReply }: TimelineItemProps) {
  const { t } = useTranslation();
  const { event: nostrEvent, profile, contentWarning } = event;
  const isProfile = nostrEvent.kind === 0;
  const isTextNote = nostrEvent.kind === 1;
  const isRepost = nostrEvent.kind === 6;
  const isReaction = nostrEvent.kind === 7;
  const hasContentWarning = contentWarning !== undefined;

  const [revealed, setRevealed] = useState(false);
  const [reacted, setReacted] = useState(() => isEventReacted(nostrEvent.id));
  const [reposted, setReposted] = useState(() => isEventReposted(nostrEvent.id));
  const [actionPending, setActionPending] = useState(false);

  // Fetch referenced events for quote/reply/repost/reaction (supports multiple references)
  const { referenceType, referencedEvents, loading: refLoading } = useReferencedEvents(nostrEvent);

  // Show npub if no profile name available
  const displayName = profile?.display_name || profile?.name || formatNpub(nostrEvent.pubkey);
  const userName = profile?.name || formatNpub(nostrEvent.pubkey);

  const handleReveal = () => {
    setRevealed(true);
  };

  const handleReaction = async () => {
    if (reacted || actionPending) return;
    setActionPending(true);
    const success = await sendReaction(nostrEvent.id, nostrEvent.pubkey);
    if (success) {
      setReacted(true);
    }
    setActionPending(false);
  };

  const handleRepost = async () => {
    if (reposted || actionPending) return;
    setActionPending(true);
    const success = await sendRepost(nostrEvent.id, nostrEvent.pubkey);
    if (success) {
      setReposted(true);
    }
    setActionPending(false);
  };

  const handleReply = () => {
    if (onReply) {
      onReply(nostrEvent, profile);
    }
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
        <a
          href={`https://nostter.app/${pubkeyToNpub(nostrEvent.pubkey)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
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
        </a>
        <div className="timeline-item-names">
          <a
            href={`https://nostter.app/${pubkeyToNpub(nostrEvent.pubkey)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="timeline-link-author"
          >
            <span className="timeline-item-display-name">
              {displayName}
            </span>
            <span className="timeline-item-name">
              @{userName}
            </span>
          </a>
        </div>
      </div>
      <div className="timeline-item-content">
        {renderContent()}
      </div>
      <div className="timeline-item-footer">
        <a
          href={`https://nostter.app/${eventIdToNevent(nostrEvent.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="timeline-link-time"
        >
          {formatDate(nostrEvent.created_at)}
        </a>
        {isTextNote && (
          <div className="timeline-item-actions">
            <button
              className="timeline-action-button"
              onClick={handleReply}
              title="Reply"
            >
              ↩
            </button>
            <button
              className={`timeline-action-button ${reacted ? 'active' : ''}`}
              onClick={handleReaction}
              disabled={reacted || actionPending}
              title="Reaction"
            >
              ♥
            </button>
            <button
              className={`timeline-action-button ${reposted ? 'active' : ''}`}
              onClick={handleRepost}
              disabled={reposted || actionPending}
              title="Repost"
            >
              ⟲
            </button>
          </div>
        )}
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
  onReply?: (event: NostrEvent, profile?: Profile) => void;
}

export function TimelineGenericItemComponent({ item, onReply }: TimelineGenericItemProps) {
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
          onReply={onReply}
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
