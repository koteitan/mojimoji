import type { Profile } from './types';

const DEBUG = false;

// Global profile cache shared across all nodes
const PROFILE_CACHE_KEY = 'mojimoji-profile-cache';
const profileCache = new Map<string, Profile>();

// Load cache from localStorage on startup
function loadProfileCache(): void {
  try {
    const stored = localStorage.getItem(PROFILE_CACHE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as Record<string, Profile>;
      for (const [pubkey, profile] of Object.entries(data)) {
        profileCache.set(pubkey, profile);
      }
    }
  } catch {
    // Ignore errors when loading cache
  }
}

// Save cache to localStorage (debounced to avoid excessive writes)
let saveProfileCacheTimer: ReturnType<typeof setTimeout> | null = null;

function saveProfileCache(): void {
  // Debounce: wait 500ms after last call before actually saving
  if (saveProfileCacheTimer) {
    clearTimeout(saveProfileCacheTimer);
  }
  saveProfileCacheTimer = setTimeout(() => {
    saveProfileCacheTimer = null;
    try {
      const data: Record<string, Profile> = {};
      for (const [pubkey, profile] of profileCache) {
        data[pubkey] = profile;
      }
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
      if (DEBUG) console.log('Profile cache saved to localStorage');
    } catch {
      // Ignore errors when saving cache (e.g., quota exceeded)
    }
  }, 500);
}

// Initialize cache from localStorage
loadProfileCache();

/**
 * Get a cached profile by pubkey
 */
export function getCachedProfile(pubkey: string): Profile | undefined {
  return profileCache.get(pubkey);
}

/**
 * Save a profile to the cache and persist to localStorage
 */
export function saveProfileToCache(pubkey: string, profile: Profile): void {
  profileCache.set(pubkey, profile);
  saveProfileCache();
}

/**
 * Find pubkeys by name/display_name partial match (all matches)
 */
export function findPubkeysByName(searchTerm: string): string[] {
  const results: string[] = [];
  const searchLower = searchTerm.toLowerCase();

  for (const [pubkey, profile] of profileCache) {
    const name = profile.name?.toLowerCase() || '';
    const displayName = profile.display_name?.toLowerCase() || '';
    if (name.includes(searchLower) || displayName.includes(searchLower)) {
      results.push(pubkey);
    }
  }

  return results;
}

/**
 * Get cache info for debugging
 */
export function getProfileCacheInfo(): { count: number; bytes: number } {
  const data: Record<string, Profile> = {};
  for (const [pubkey, profile] of profileCache) {
    data[pubkey] = profile;
  }
  const json = JSON.stringify(data);
  return {
    count: profileCache.size,
    bytes: new Blob([json]).size,
  };
}

/**
 * Get the internal profile cache Map (for iteration in resolveIdentifier)
 */
export function getProfileCache(): Map<string, Profile> {
  return profileCache;
}

/**
 * Get all cached profiles as array (for autocomplete)
 */
export function getAllCachedProfiles(): Array<{ pubkey: string; profile: Profile }> {
  const results: Array<{ pubkey: string; profile: Profile }> = [];
  for (const [pubkey, profile] of profileCache) {
    results.push({ pubkey, profile });
  }
  return results;
}
