import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function hotjar(siteId: string, snippetVersion = 6) {
  return {
    service: {
      id: 'hotjar',
      label: 'Hotjar',
      cookies: ['_hj*'],
      scripts: [`static.hotjar.com/c/hotjar-${siteId}.js`],
    } as ConsentService,
    gcm: {
      analytics: ['analytics_storage'],
    } as Record<string, GCMSignal[]>,
    siteId,
    snippetVersion,
  };
}
