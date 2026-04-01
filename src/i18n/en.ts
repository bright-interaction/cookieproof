import type { TranslationStrings } from '../core/types.js';

export const en: TranslationStrings = {
  banner: {
    title: 'We respect your privacy',
    description:
      'We use cookies to improve your experience. You can choose which categories to accept.',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    settings: 'Settings',
    privacyPolicy: 'Privacy Policy',
    doNotSell: 'Do Not Sell My Info',
  },
  preferences: {
    title: 'Cookie settings',
    save: 'Save preferences',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    privacyPolicy: 'Privacy Policy',
    moreInfo: 'Learn more',
    moreInfoText: 'We use cookies and similar technologies to provide, protect, and improve our services. You can manage your preferences at any time. For more details on how we process your data, please read our privacy policy.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Provider',
    cookieTablePurpose: 'Purpose',
    cookieTableExpiry: 'Expiry',
  },
  categories: {
    necessary: {
      label: 'Necessary',
      description: 'Required for the website to function properly. Cannot be disabled.',
    },
    analytics: {
      label: 'Analytics',
      description: 'Help us understand how visitors use the website.',
    },
    marketing: {
      label: 'Marketing',
      description: 'Used to deliver relevant advertisements.',
    },
    preferences: {
      label: 'Preferences',
      description: 'Remember your settings and personalisation choices.',
    },
  },
  trigger: {
    ariaLabel: 'Privacy settings',
  },
  alwaysOnLabel: 'Always active',
  gpcNotice: 'Global Privacy Control signal detected — non-essential cookies have been blocked.',
  expiryNotice: 'Your cookie preferences expire in {days} days. Please review your settings.',
  ccpa: {
    linkText: 'Do Not Sell or Share My Personal Information',
    confirmTitle: 'Do Not Sell or Share',
    confirmDescription: 'You have the right to opt out of the sale or sharing of your personal information. By confirming, marketing and advertising cookies will be disabled.',
    confirmButton: 'Confirm Opt-Out',
    cancelButton: 'Cancel',
    optedOut: 'You have opted out of the sale of your personal information.',
  },
};
