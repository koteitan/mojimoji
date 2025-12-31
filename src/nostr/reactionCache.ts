// Reaction/Repost cache for Timeline
// Stores reactions (kind:7) and reposts (kind:6) for events

import type { NostrEvent } from './types';

// Reaction data for a single event
export interface ReactionData {
  reactions: NostrEvent[];  // kind:7 events
  reposts: NostrEvent[];    // kind:6 events
}

// Cache: eventId -> ReactionData
const reactionCache: Map<string, ReactionData> = new Map();

// Callbacks for UI updates
type ReactionUpdateCallback = (eventId: string, data: ReactionData) => void;
const updateCallbacks: Set<ReactionUpdateCallback> = new Set();

/**
 * Get cached reactions for an event
 */
export function getCachedReactions(eventId: string): ReactionData | undefined {
  return reactionCache.get(eventId);
}

/**
 * Get or create reaction data for an event
 */
function getOrCreateReactionData(eventId: string): ReactionData {
  let data = reactionCache.get(eventId);
  if (!data) {
    data = { reactions: [], reposts: [] };
    reactionCache.set(eventId, data);
  }
  return data;
}

/**
 * Add a reaction to the cache
 */
export function addReactionToCache(eventId: string, reactionEvent: NostrEvent): void {
  const data = getOrCreateReactionData(eventId);

  // Check for duplicate
  if (data.reactions.some(r => r.id === reactionEvent.id)) {
    return;
  }

  data.reactions.push(reactionEvent);
  notifyUpdate(eventId, data);
}

/**
 * Add a repost to the cache
 */
export function addRepostToCache(eventId: string, repostEvent: NostrEvent): void {
  const data = getOrCreateReactionData(eventId);

  // Check for duplicate
  if (data.reposts.some(r => r.id === repostEvent.id)) {
    return;
  }

  data.reposts.push(repostEvent);
  notifyUpdate(eventId, data);
}

/**
 * Check if a user has reacted to an event
 */
export function hasUserReacted(eventId: string, userPubkey: string): NostrEvent | undefined {
  const data = reactionCache.get(eventId);
  if (!data) return undefined;
  return data.reactions.find(r => r.pubkey === userPubkey);
}

/**
 * Check if a user has reposted an event
 */
export function hasUserReposted(eventId: string, userPubkey: string): NostrEvent | undefined {
  const data = reactionCache.get(eventId);
  if (!data) return undefined;
  return data.reposts.find(r => r.pubkey === userPubkey);
}

/**
 * Register a callback for reaction updates
 */
export function onReactionUpdate(callback: ReactionUpdateCallback): () => void {
  updateCallbacks.add(callback);
  return () => updateCallbacks.delete(callback);
}

/**
 * Notify all callbacks of an update
 */
function notifyUpdate(eventId: string, data: ReactionData): void {
  for (const callback of updateCallbacks) {
    callback(eventId, data);
  }
}

/**
 * Get reaction count for an event
 */
export function getReactionCount(eventId: string): number {
  const data = reactionCache.get(eventId);
  return data?.reactions.length ?? 0;
}

/**
 * Get repost count for an event
 */
export function getRepostCount(eventId: string): number {
  const data = reactionCache.get(eventId);
  return data?.reposts.length ?? 0;
}
