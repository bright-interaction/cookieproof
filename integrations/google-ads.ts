import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function googleAds(conversionId?: string) {
  return {
    service: {
      id: 'google-ads',
      label: 'Google Ads',
      description: 'Conversion tracking and remarketing by Google Ads',
      cookies: ['_gcl_au', '_gcl_aw', 'IDE', 'test_cookie'],
      scripts: conversionId
        ? [`googleadservices.com/pagead/conversion/${conversionId}`]
        : ['googleadservices.com', 'googleads.g.doubleclick.net'],
    } as ConsentService,
    gcm: {
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    } as Record<string, GCMSignal[]>,
    conversionId,
  };
}
