import type { TranslationStrings } from '../core/types.js';

export const da: TranslationStrings = {
  banner: {
    title: 'Vi respekterer dit privatliv',
    description:
      'Vi bruger cookies til at forbedre din oplevelse. Du kan vælge hvilke kategorier du accepterer.',
    acceptAll: 'Accepter alle',
    rejectAll: 'Afvis alle',
    settings: 'Indstillinger',
    privacyPolicy: 'Privatlivspolitik',
    doNotSell: 'Sælg ikke mine oplysninger',
  },
  preferences: {
    title: 'Cookie-indstillinger',
    save: 'Gem indstillinger',
    acceptAll: 'Accepter alle',
    rejectAll: 'Afvis alle',
    privacyPolicy: 'Privatlivspolitik',
    moreInfo: 'Læs mere',
    moreInfoText: 'Vi bruger cookies og lignende teknologier til at levere, beskytte og forbedre vores tjenester. Du kan administrere dine præferencer når som helst. For flere detaljer om, hvordan vi behandler dine data, læs venligst vores privatlivspolitik.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Udbyder',
    cookieTablePurpose: 'Formål',
    cookieTableExpiry: 'Udløber',
  },
  categories: {
    necessary: {
      label: 'Nødvendige',
      description: 'Nødvendige for at hjemmesiden fungerer korrekt. Kan ikke deaktiveres.',
    },
    analytics: {
      label: 'Analyse',
      description: 'Hjælper os med at forstå, hvordan besøgende bruger hjemmesiden.',
    },
    marketing: {
      label: 'Markedsføring',
      description: 'Bruges til at vise relevante annoncer.',
    },
    preferences: {
      label: 'Præferencer',
      description: 'Husker dine indstillinger og personaliseringsvalg.',
    },
  },
  trigger: {
    ariaLabel: 'Privatlivsindstillinger',
  },
  alwaysOnLabel: 'Altid aktiv',
  ccpa: {
    linkText: 'Sælg eller del ikke mine personlige oplysninger',
    confirmTitle: 'Sælg eller del ikke',
    confirmDescription: 'Du har ret til at fravælge salg eller deling af dine personlige oplysninger. Ved at bekræfte vil marketing- og annoncecookies blive deaktiveret.',
    confirmButton: 'Bekræft fravalg',
    cancelButton: 'Annuller',
    optedOut: 'Du har fravalgt salg af dine personlige oplysninger.',
  },
};
