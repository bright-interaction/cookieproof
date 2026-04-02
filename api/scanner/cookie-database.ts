export interface KnownCookie {
  name: string;         // Cookie name or pattern (supports * wildcard)
  provider: string;     // Company name
  service: string;      // Service name (e.g., "Google Analytics 4")
  category: 'necessary' | 'analytics' | 'marketing' | 'preferences';
  purpose: string;      // Human-readable purpose
  expiry: string;       // "Session", "1 year", "2 years", etc.
}

export const KNOWN_COOKIES: KnownCookie[] = [
  // --- Google Analytics 4 ---
  { name: '_ga', provider: 'Google', service: 'Google Analytics 4', category: 'analytics', purpose: 'Distinguishes unique users by assigning a randomly generated number as a client identifier', expiry: '2 years' },
  { name: '_ga_*', provider: 'Google', service: 'Google Analytics 4', category: 'analytics', purpose: 'Used to persist session state', expiry: '2 years' },
  { name: '_gid', provider: 'Google', service: 'Google Analytics 4', category: 'analytics', purpose: 'Distinguishes users for 24 hours', expiry: '24 hours' },
  { name: '_gac_*', provider: 'Google', service: 'Google Analytics 4', category: 'analytics', purpose: 'Contains campaign related information for the user', expiry: '90 days' },

  // --- Google Ads ---
  { name: '_gcl_au', provider: 'Google', service: 'Google Ads', category: 'marketing', purpose: 'Used to store and track conversions', expiry: '90 days' },
  { name: '_gcl_aw', provider: 'Google', service: 'Google Ads', category: 'marketing', purpose: 'Conversion linker for Google Ads click tracking', expiry: '90 days' },

  // --- Google Tag Manager ---
  // GTM itself sets no cookies but loads other scripts

  // --- Meta / Facebook ---
  { name: '_fbp', provider: 'Meta', service: 'Meta Pixel', category: 'marketing', purpose: 'Used to deliver, measure, and improve advertising relevance', expiry: '3 months' },
  { name: '_fbc', provider: 'Meta', service: 'Meta Pixel', category: 'marketing', purpose: 'Stores click identifier from Facebook ad clicks', expiry: '3 months' },
  { name: 'fr', provider: 'Meta', service: 'Meta Pixel', category: 'marketing', purpose: 'Used for retargeting and advertising delivery', expiry: '3 months' },

  // --- LinkedIn ---
  { name: 'li_sugr', provider: 'LinkedIn', service: 'LinkedIn Insight Tag', category: 'marketing', purpose: 'Used for LinkedIn conversion tracking', expiry: '3 months' },
  { name: 'UserMatchHistory', provider: 'LinkedIn', service: 'LinkedIn Insight Tag', category: 'marketing', purpose: 'LinkedIn Ads ID syncing', expiry: '30 days' },
  { name: 'li_fat_id', provider: 'LinkedIn', service: 'LinkedIn Insight Tag', category: 'marketing', purpose: 'LinkedIn member indirect identifier for conversion tracking', expiry: '30 days' },
  { name: 'ln_or', provider: 'LinkedIn', service: 'LinkedIn Insight Tag', category: 'marketing', purpose: 'Determines if Oribi analytics can be carried out on a specific domain', expiry: '1 day' },

  // --- TikTok ---
  { name: '_ttp', provider: 'TikTok', service: 'TikTok Pixel', category: 'marketing', purpose: 'Used by TikTok to track visits and attribute conversions', expiry: '13 months' },
  { name: 'tt_scid', provider: 'TikTok', service: 'TikTok Pixel', category: 'marketing', purpose: 'Session cookie for TikTok pixel', expiry: 'Session' },

  // --- HubSpot ---
  { name: 'hubspotutk', provider: 'HubSpot', service: 'HubSpot', category: 'marketing', purpose: 'Keeps track of visitors identity for HubSpot CRM', expiry: '13 months' },
  { name: '__hstc', provider: 'HubSpot', service: 'HubSpot', category: 'marketing', purpose: 'Main tracking cookie containing visitor identity, timestamp, and session information', expiry: '13 months' },
  { name: '__hssc', provider: 'HubSpot', service: 'HubSpot', category: 'marketing', purpose: 'Keeps track of sessions and determines if a new session needs to be created', expiry: '30 minutes' },
  { name: '__hssrc', provider: 'HubSpot', service: 'HubSpot', category: 'marketing', purpose: 'Used to determine if the visitor has restarted the browser', expiry: 'Session' },
  { name: 'messagesUtk', provider: 'HubSpot', service: 'HubSpot Live Chat', category: 'marketing', purpose: 'Used to recognize visitors who chat via the messages tool', expiry: '13 months' },

  // --- Hotjar ---
  { name: '_hj*', provider: 'Hotjar', service: 'Hotjar', category: 'analytics', purpose: 'Hotjar analytics and user feedback tools', expiry: '1 year' },

  // --- Matomo ---
  { name: '_pk_id.*', provider: 'Matomo', service: 'Matomo Analytics', category: 'analytics', purpose: 'Stores unique visitor ID', expiry: '13 months' },
  { name: '_pk_ses.*', provider: 'Matomo', service: 'Matomo Analytics', category: 'analytics', purpose: 'Stores temporary session data', expiry: '30 minutes' },
  { name: '_pk_ref.*', provider: 'Matomo', service: 'Matomo Analytics', category: 'analytics', purpose: 'Stores attribution referrer information', expiry: '6 months' },

  // --- Microsoft Clarity ---
  { name: '_clck', provider: 'Microsoft', service: 'Microsoft Clarity', category: 'analytics', purpose: 'Persists the Clarity user ID and preferences', expiry: '1 year' },
  { name: '_clsk', provider: 'Microsoft', service: 'Microsoft Clarity', category: 'analytics', purpose: 'Stores and combines pageviews into a single session recording', expiry: '1 day' },
  { name: 'CLID', provider: 'Microsoft', service: 'Microsoft Clarity', category: 'analytics', purpose: 'Identifies the first-time Clarity saw this user on any site', expiry: '1 year' },

  // --- Segment ---
  { name: 'ajs_anonymous_id', provider: 'Segment', service: 'Segment', category: 'analytics', purpose: 'Anonymous user identifier for Segment analytics', expiry: '1 year' },
  { name: 'ajs_user_id', provider: 'Segment', service: 'Segment', category: 'analytics', purpose: 'Known user identifier for Segment analytics', expiry: '1 year' },

  // --- Mixpanel ---
  { name: 'mp_*_mixpanel', provider: 'Mixpanel', service: 'Mixpanel', category: 'analytics', purpose: 'Mixpanel analytics tracking cookie', expiry: '1 year' },

  // --- Twitter/X ---
  { name: 'twclid', provider: 'Twitter/X', service: 'Twitter/X Pixel', category: 'marketing', purpose: 'Twitter click identifier for conversion tracking', expiry: '2 years' },
  { name: 'muc_ads', provider: 'Twitter/X', service: 'Twitter/X Pixel', category: 'marketing', purpose: 'Used for advertising purposes by Twitter', expiry: '2 years' },

  // --- Google Ads Conversion ---
  { name: 'IDE', provider: 'Google', service: 'Google DoubleClick', category: 'marketing', purpose: 'Used for ad targeting and measurement by DoubleClick', expiry: '13 months' },
  { name: 'test_cookie', provider: 'Google', service: 'Google DoubleClick', category: 'marketing', purpose: 'Used to check if the browser supports cookies', expiry: '15 minutes' },

  // --- Stripe ---
  { name: '__stripe_mid', provider: 'Stripe', service: 'Stripe', category: 'necessary', purpose: 'Fraud prevention and detection', expiry: '1 year' },
  { name: '__stripe_sid', provider: 'Stripe', service: 'Stripe', category: 'necessary', purpose: 'Fraud prevention and session detection', expiry: '30 minutes' },

  // --- Cloudflare ---
  { name: '__cf_bm', provider: 'Cloudflare', service: 'Cloudflare Bot Management', category: 'necessary', purpose: 'Bot detection and management', expiry: '30 minutes' },
  { name: 'cf_clearance', provider: 'Cloudflare', service: 'Cloudflare', category: 'necessary', purpose: 'Indicates the visitor has passed a Cloudflare challenge', expiry: '30 minutes' },

  // --- Intercom ---
  { name: 'intercom-id-*', provider: 'Intercom', service: 'Intercom', category: 'preferences', purpose: 'Identifies anonymous visitors for live chat', expiry: '9 months' },
  { name: 'intercom-session-*', provider: 'Intercom', service: 'Intercom', category: 'preferences', purpose: 'Maintains live chat session', expiry: '1 week' },

  // --- Crisp ---
  { name: 'crisp-client/*', provider: 'Crisp', service: 'Crisp Chat', category: 'preferences', purpose: 'Maintains live chat session and user identity', expiry: '6 months' },

  // --- Cookiebot ---
  { name: 'CookieConsent', provider: 'Cookiebot', service: 'Cookiebot', category: 'necessary', purpose: 'Stores cookie consent state', expiry: '1 year' },

  // --- Common consent cookies ---
  { name: 'cc_consent', provider: 'cookieproof', service: 'cookieproof', category: 'necessary', purpose: 'Stores cookie consent preferences', expiry: '1 year' },
];

/** Known script URL patterns that indicate a service is loaded */
export interface KnownScript {
  pattern: string;     // Substring match against script src
  provider: string;
  service: string;
  category: 'necessary' | 'analytics' | 'marketing' | 'preferences';
}

export const KNOWN_SCRIPTS: KnownScript[] = [
  { pattern: 'googletagmanager.com/gtag', provider: 'Google', service: 'Google Analytics 4', category: 'analytics' },
  { pattern: 'googletagmanager.com/gtm', provider: 'Google', service: 'Google Tag Manager', category: 'analytics' },
  { pattern: 'google-analytics.com/analytics', provider: 'Google', service: 'Google Analytics (UA)', category: 'analytics' },
  { pattern: 'googleads.g.doubleclick.net', provider: 'Google', service: 'Google Ads', category: 'marketing' },
  { pattern: 'googlesyndication.com', provider: 'Google', service: 'Google AdSense', category: 'marketing' },
  { pattern: 'googleadservices.com', provider: 'Google', service: 'Google Ads Conversion', category: 'marketing' },
  { pattern: 'connect.facebook.net', provider: 'Meta', service: 'Meta Pixel', category: 'marketing' },
  { pattern: 'snap.licdn.com', provider: 'LinkedIn', service: 'LinkedIn Insight Tag', category: 'marketing' },
  { pattern: 'analytics.tiktok.com', provider: 'TikTok', service: 'TikTok Pixel', category: 'marketing' },
  { pattern: 'js.hs-scripts.com', provider: 'HubSpot', service: 'HubSpot', category: 'marketing' },
  { pattern: 'js.hs-analytics.net', provider: 'HubSpot', service: 'HubSpot Analytics', category: 'marketing' },
  { pattern: 'static.hotjar.com', provider: 'Hotjar', service: 'Hotjar', category: 'analytics' },
  { pattern: 'plausible.io', provider: 'Plausible', service: 'Plausible Analytics', category: 'analytics' },
  { pattern: 'cloud.umami.is', provider: 'Umami', service: 'Umami Analytics', category: 'analytics' },
  { pattern: 'matomo.js', provider: 'Matomo', service: 'Matomo Analytics', category: 'analytics' },
  { pattern: 'clarity.ms', provider: 'Microsoft', service: 'Microsoft Clarity', category: 'analytics' },
  { pattern: 'cdn.segment.com', provider: 'Segment', service: 'Segment', category: 'analytics' },
  { pattern: 'cdn.mxpnl.com', provider: 'Mixpanel', service: 'Mixpanel', category: 'analytics' },
  { pattern: 'static.ads-twitter.com', provider: 'Twitter/X', service: 'Twitter/X Pixel', category: 'marketing' },
  { pattern: 'widget.intercom.io', provider: 'Intercom', service: 'Intercom', category: 'preferences' },
  { pattern: 'client.crisp.chat', provider: 'Crisp', service: 'Crisp Chat', category: 'preferences' },
  { pattern: 'js.stripe.com', provider: 'Stripe', service: 'Stripe', category: 'necessary' },
];
