import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function segment(writeKey?: string) {
  return {
    service: {
      id: 'segment',
      label: 'Segment',
      description: 'Customer data platform for analytics and integrations',
      cookies: ['ajs_anonymous_id', 'ajs_user_id'],
      scripts: writeKey
        ? [`cdn.segment.com/analytics.js/v1/${writeKey}/analytics.min.js`]
        : [],
    } as ConsentService,
    gcm: {
      analytics: ['analytics_storage'],
    } as Record<string, GCMSignal[]>,
    writeKey,
  };
}
