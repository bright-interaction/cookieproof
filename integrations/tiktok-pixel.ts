import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function tiktokPixel(pixelId?: string) {
  return {
    service: {
      id: 'tiktok-pixel',
      label: 'TikTok Pixel',
      cookies: ['_ttp', 'tt_scid'],
      scripts: ['analytics.tiktok.com'],
    } as ConsentService,
    gcm: {
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    } as Record<string, GCMSignal[]>,
    pixelId,
  };
}
