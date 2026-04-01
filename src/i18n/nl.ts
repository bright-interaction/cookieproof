import type { TranslationStrings } from '../core/types.js';

export const nl: TranslationStrings = {
  banner: {
    title: 'Wij respecteren uw privacy',
    description:
      'Wij gebruiken cookies om uw ervaring te verbeteren. U kunt kiezen welke categorieën u accepteert.',
    acceptAll: 'Alles accepteren',
    rejectAll: 'Alles weigeren',
    settings: 'Instellingen',
    privacyPolicy: 'Privacybeleid',
    doNotSell: 'Verkoop mijn gegevens niet',
  },
  preferences: {
    title: 'Cookie-instellingen',
    save: 'Voorkeuren opslaan',
    acceptAll: 'Alles accepteren',
    rejectAll: 'Alles weigeren',
    privacyPolicy: 'Privacybeleid',
    moreInfo: 'Meer informatie',
    moreInfoText: 'Wij gebruiken cookies en vergelijkbare technologieën om onze diensten te leveren, te beschermen en te verbeteren. U kunt uw voorkeuren op elk moment beheren. Lees ons privacybeleid voor meer informatie over hoe wij uw gegevens verwerken.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Aanbieder',
    cookieTablePurpose: 'Doel',
    cookieTableExpiry: 'Verloop',
  },
  categories: {
    necessary: {
      label: 'Noodzakelijk',
      description: 'Vereist voor het functioneren van de website. Kan niet worden uitgeschakeld.',
    },
    analytics: {
      label: 'Analytisch',
      description: 'Helpen ons te begrijpen hoe bezoekers de website gebruiken.',
    },
    marketing: {
      label: 'Marketing',
      description: 'Worden gebruikt om relevante advertenties te tonen.',
    },
    preferences: {
      label: 'Voorkeuren',
      description: 'Onthouden uw instellingen en persoonlijke keuzes.',
    },
  },
  trigger: {
    ariaLabel: 'Privacy-instellingen',
  },
  alwaysOnLabel: 'Altijd actief',
  ccpa: {
    linkText: 'Verkoop of deel mijn persoonlijke gegevens niet',
    confirmTitle: 'Niet verkopen of delen',
    confirmDescription: 'U heeft het recht om de verkoop of het delen van uw persoonlijke gegevens te weigeren. Door te bevestigen worden marketing- en advertentiecookies uitgeschakeld.',
    confirmButton: 'Opt-out bevestigen',
    cancelButton: 'Annuleren',
    optedOut: 'U heeft gekozen om niet deel te nemen aan de verkoop van uw persoonlijke gegevens.',
  },
};
