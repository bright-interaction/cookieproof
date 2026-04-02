import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function hubspot(portalId?: string): { service: ConsentService; gcm: Record<string, GCMSignal[]> } {
  return {
    service: {
      id: 'hubspot',
      label: 'HubSpot',
      description: 'Marketing automation and CRM tracking by HubSpot',
      cookies: ['hubspotutk', '__hstc', '__hssc', '__hssrc', 'messagesUtk'],
      scripts: portalId
        ? [`js.hs-scripts.com/${portalId}.js`]
        : ['js.hs-scripts.com', 'js.hs-analytics.net'],
    },
    gcm: {
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'],
    },
  };
}
