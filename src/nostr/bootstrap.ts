// Bootstrap relay utilities
// Get default relay based on browser/i18n locale

import i18next from 'i18next';

// Get bootstrap relay URL based on locale
// Japanese users -> yabu.me, others -> relay.damus.io
export function getBootstrapRelayUrl(): string {
  const lang = i18next.language || (typeof navigator !== 'undefined' ? navigator.language : 'en');
  if (lang.startsWith('ja')) {
    return 'wss://yabu.me';
  }
  return 'wss://relay.damus.io';
}

// Get bootstrap relays as array (for APIs that expect string[])
export function getBootstrapRelays(): string[] {
  return [getBootstrapRelayUrl()];
}
