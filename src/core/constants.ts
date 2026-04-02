import type { CategoryConfig, GCMSignal } from './types.js';

export const VERSION = '0.1.0';
export const STORAGE_KEY = 'ce_consent';
export const COOKIE_NAME = 'ce_consent';
export const DEFAULT_EXPIRY_DAYS = 365;

export const DEFAULT_CATEGORIES: CategoryConfig[] = [
  {
    id: 'necessary',
    required: true,
    enabled: true,
  },
  {
    id: 'analytics',
    required: false,
    enabled: false,
  },
  {
    id: 'marketing',
    required: false,
    enabled: false,
  },
  {
    id: 'preferences',
    required: false,
    enabled: false,
  },
];

export const DEFAULT_GCM_MAPPING: Record<string, GCMSignal[]> = {
  necessary: ['security_storage'],
  analytics: ['analytics_storage'],
  marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  preferences: ['functionality_storage', 'personalization_storage'],
};
