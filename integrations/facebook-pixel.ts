import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function facebookPixel(pixelId?: string) {
  return {
    service: {
      id: 'facebook-pixel',
      label: 'Facebook Pixel',
      cookies: ['_fbp', '_fbc', 'fr'],
      scripts: ['connect.facebook.net/en_US/fbevents.js'],
    } as ConsentService,
    gcm: {
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    } as Record<string, GCMSignal[]>,
    pixelId, // expose for snippet generation
  };
}
