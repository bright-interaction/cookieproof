import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function twitterPixel(pixelId?: string) {
  return {
    service: {
      id: 'twitter-pixel',
      label: 'Twitter/X Pixel',
      description: 'Conversion tracking and audience targeting by Twitter/X',
      cookies: ['twclid', 'muc_ads'],
      scripts: ['static.ads-twitter.com/uwt.js'],
    } as ConsentService,
    gcm: {
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    } as Record<string, GCMSignal[]>,
    pixelId,
  };
}
