import type { TranslationStrings } from '../core/types.js';

export const fr: TranslationStrings = {
  banner: {
    title: 'Nous respectons votre vie privée',
    description:
      'Nous utilisons des cookies pour améliorer votre expérience. Vous pouvez choisir les catégories à accepter.',
    acceptAll: 'Tout accepter',
    rejectAll: 'Tout refuser',
    settings: 'Paramètres',
    privacyPolicy: 'Politique de confidentialité',
    doNotSell: 'Ne pas vendre mes données',
  },
  preferences: {
    title: 'Paramètres des cookies',
    save: 'Enregistrer les préférences',
    acceptAll: 'Tout accepter',
    rejectAll: 'Tout refuser',
    privacyPolicy: 'Politique de confidentialité',
    moreInfo: 'En savoir plus',
    moreInfoText: 'Nous utilisons des cookies et des technologies similaires pour fournir, protéger et améliorer nos services. Vous pouvez gérer vos préférences à tout moment. Pour plus de détails sur le traitement de vos données, veuillez consulter notre politique de confidentialité.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Fournisseur',
    cookieTablePurpose: 'Finalité',
    cookieTableExpiry: 'Expiration',
  },
  categories: {
    necessary: {
      label: 'Nécessaires',
      description: 'Indispensables au bon fonctionnement du site. Ne peuvent pas être désactivés.',
    },
    analytics: {
      label: 'Analytiques',
      description: 'Nous aident à comprendre comment les visiteurs utilisent le site.',
    },
    marketing: {
      label: 'Marketing',
      description: 'Utilisés pour diffuser des publicités pertinentes.',
    },
    preferences: {
      label: 'Préférences',
      description: 'Mémorisent vos paramètres et choix de personnalisation.',
    },
  },
  trigger: {
    ariaLabel: 'Paramètres de confidentialité',
  },
  alwaysOnLabel: 'Toujours actif',
  ccpa: {
    linkText: 'Ne pas vendre ni partager mes informations personnelles',
    confirmTitle: 'Ne pas vendre ni partager',
    confirmDescription: 'Vous avez le droit de refuser la vente ou le partage de vos informations personnelles. En confirmant, les cookies de marketing et de publicité seront désactivés.',
    confirmButton: 'Confirmer le refus',
    cancelButton: 'Annuler',
    optedOut: 'Vous avez refusé la vente de vos informations personnelles.',
  },
};
