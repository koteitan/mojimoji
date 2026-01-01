import type { NostrEvent } from './types';

// In-memory event cache for referenced events (quote/reply/repost/reaction targets)
// Unlike profileCache, this doesn't persist to localStorage since events are larger
// and referenced events are typically session-specific
const eventCache = new Map<string, NostrEvent>();

/**
 * Get a cached event by event ID
 */
export function getCachedEvent(eventId: string): NostrEvent | undefined {
  return eventCache.get(eventId);
}

/**
 * Save an event to the cache
 */
export function saveEventToCache(event: NostrEvent): void {
  eventCache.set(event.id, event);
}

/**
 * Check if an event is cached
 */
export function isEventCached(eventId: string): boolean {
  return eventCache.has(eventId);
}

/**
 * Get cache info for debugging
 */
export function getEventCacheInfo(): { count: number } {
  return {
    count: eventCache.size,
  };
}

/**
 * Clear the event cache
 */
export function clearEventCache(): void {
  eventCache.clear();
}
