// --- Consent State ---

export interface ConsentRecord {
  version: number;
  timestamp: number;
  categories: Record<string, boolean>;
  method: 'accept-all' | 'reject-all' | 'custom' | 'gpc' | 'dns' | 'do-not-sell';
}

// --- Category Configuration ---

export interface ConsentService {
  id: string;
  label: string;
  description?: string;
  cookies?: string[];
  scripts?: string[];
}

export interface CookieDeclaration {
  name: string;
  provider?: string;
  purpose?: string;
  expiry?: string; // "Session", "1 year", "2 years", etc.
}

export interface CategoryConfig {
  id: string;
  label?: string;
  description?: string;
  required?: boolean;
  enabled?: boolean;
  services?: ConsentService[];
  declarations?: CookieDeclaration[];
}

// --- Google Consent Mode V2 ---

export type GCMSignal =
  | 'ad_storage'
  | 'analytics_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'functionality_storage'
  | 'personalization_storage'
  | 'security_storage';

export type GCMMapping = Partial<Record<GCMSignal, 'granted' | 'denied'>>;

// --- Translation Strings ---

export interface CategoryTranslation {
  label: string;
  description: string;
}

export interface TranslationStrings {
  banner: {
    title: string;
    description: string;
    acceptAll: string;
    rejectAll: string;
    settings: string;
    privacyPolicy: string;
    doNotSell?: string;
  };
  preferences: {
    title: string;
    save: string;
    acceptAll: string;
    rejectAll?: string;
    privacyPolicy: string;
    moreInfo: string;
    moreInfoText: string;
    cookieTableName: string;
    cookieTableProvider: string;
    cookieTablePurpose: string;
    cookieTableExpiry: string;
  };
  categories: Record<string, CategoryTranslation>;
  trigger: {
    ariaLabel: string;
  };
  alwaysOnLabel?: string;
  /** GPC (Global Privacy Control) signal notice */
  gpcNotice?: string;
  /** Expiry notice shown when consent is about to expire. Use {days} placeholder. */
  expiryNotice?: string;
  ccpa?: {
    linkText: string;
    confirmTitle: string;
    confirmDescription: string;
    confirmButton: string;
    cancelButton: string;
    optedOut: string;
  };
}

// --- Main Config ---

export interface CookieConsentConfig {
  categories?: CategoryConfig[];
  language?: string;
  translations?: Record<string, TranslationStrings>;
  storage?: 'localStorage' | 'cookie';
  cookieName?: string;
  cookieExpiry?: number;
  revision?: number;
  position?: 'bottom' | 'top' | 'center';
  theme?: 'light' | 'dark' | 'auto';
  gcmEnabled?: boolean;
  gcmMapping?: Record<string, GCMSignal[]>;
  /** Milliseconds to wait for consent update before tags fire (GCM V2, default 2500) */
  gcmWaitForUpdate?: number;
  floatingTrigger?: boolean | 'left' | 'right';
  privacyPolicyUrl?: string;
  respectGPC?: boolean;
  /** Show a "Do Not Sell or Share" link (CCPA/CPRA compliance) */
  ccpaEnabled?: boolean;
  /** URL to your "Do Not Sell" disclosure page */
  ccpaUrl?: string;
  proofEndpoint?: string;
  cookieDomain?: string;
  geoEndpoint?: string;
  /** No UI rendered — ConsentManager, ScriptGate, and events still work. For custom UI implementations. */
  headless?: boolean;
  /** Days before consent expires to emit consent:expiring event. 0 = disabled (default). */
  expiryNotifyDays?: number;
  /** Show a subtle UI notice when consent is expiring. Default: false (event only). */
  expiryNotifyUI?: boolean;
  /** Keyboard shortcut to open preferences (e.g., 'Alt+C'). Default: none. */
  keyboardShortcut?: string;
  /** Language dropdown. true = all built-in languages, or array of ISO codes to limit (e.g. ['en','sv']). */
  languageSelector?: boolean | string[];
  onAccept?: (consent: ConsentRecord) => void;
  onReject?: (consent: ConsentRecord) => void;
  onChange?: (consent: ConsentRecord, changed: string[]) => void;
}

// --- Event Types ---

export type ConsentEventType =
  | 'consent:init'
  | 'consent:update'
  | 'consent:accept-all'
  | 'consent:reject-all'
  | 'consent:gpc'
  | 'consent:expiring'
  | `consent:category:${string}`;

export interface ConsentEventDetail {
  consent: ConsentRecord | null;
  changed?: string[];
  /** Present in consent:expiring events — days until consent expires */
  daysRemaining?: number;
}
