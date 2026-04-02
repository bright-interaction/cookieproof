import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function clarity(projectId?: string) {
  return {
    service: {
      id: 'clarity',
      label: 'Microsoft Clarity',
      description: 'User behavior analytics and session recording by Microsoft',
      cookies: ['_clck', '_clsk', 'CLID'],
      scripts: projectId
        ? [`clarity.ms/tag/${projectId}`]
        : ['clarity.ms'],
    } as ConsentService,
    gcm: {
      analytics: ['analytics_storage'],
    } as Record<string, GCMSignal[]>,
    projectId,
  };
}
