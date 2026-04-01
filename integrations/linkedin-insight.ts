import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function linkedinInsight(partnerId?: string) {
  return {
    service: {
      id: 'linkedin-insight',
      label: 'LinkedIn Insight Tag',
      cookies: ['li_sugr', 'UserMatchHistory', 'li_fat_id', 'ln_or'],
      scripts: ['snap.licdn.com/li.lms-analytics/insight.min.js'],
    } as ConsentService,
    gcm: {
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    } as Record<string, GCMSignal[]>,
    partnerId,
  };
}
