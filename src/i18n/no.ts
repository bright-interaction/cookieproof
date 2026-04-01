import type { TranslationStrings } from '../core/types.js';

export const no: TranslationStrings = {
  banner: {
    title: 'Vi respekterer personvernet ditt',
    description:
      'Vi bruker informasjonskapsler for å forbedre opplevelsen din. Du kan velge hvilke kategorier du godtar.',
    acceptAll: 'Godta alle',
    rejectAll: 'Avvis alle',
    settings: 'Innstillinger',
    privacyPolicy: 'Personvernerklæring',
    doNotSell: 'Ikke selg mine opplysninger',
  },
  preferences: {
    title: 'Innstillinger for informasjonskapsler',
    save: 'Lagre innstillinger',
    acceptAll: 'Godta alle',
    rejectAll: 'Avvis alle',
    privacyPolicy: 'Personvernerklæring',
    moreInfo: 'Les mer',
    moreInfoText: 'Vi bruker informasjonskapsler og lignende teknologier for å tilby, beskytte og forbedre tjenestene våre. Du kan administrere innstillingene dine når som helst. For mer informasjon om hvordan vi behandler dine data, les vår personvernerklæring.',
    cookieTableName: 'Informasjonskapsel',
    cookieTableProvider: 'Leverandør',
    cookieTablePurpose: 'Formål',
    cookieTableExpiry: 'Utløper',
  },
  categories: {
    necessary: {
      label: 'Nødvendige',
      description: 'Nødvendige for at nettstedet skal fungere. Kan ikke deaktiveres.',
    },
    analytics: {
      label: 'Analyse',
      description: 'Hjelper oss å forstå hvordan besøkende bruker nettstedet.',
    },
    marketing: {
      label: 'Markedsføring',
      description: 'Brukes til å vise relevante annonser.',
    },
    preferences: {
      label: 'Innstillinger',
      description: 'Husker innstillingene og tilpasningsvalgene dine.',
    },
  },
  trigger: {
    ariaLabel: 'Personverninnstillinger',
  },
  alwaysOnLabel: 'Alltid aktiv',
  ccpa: {
    linkText: 'Ikke selg eller del min personlige informasjon',
    confirmTitle: 'Ikke selg eller del',
    confirmDescription: 'Du har rett til å reservere deg mot salg eller deling av din personlige informasjon. Ved å bekrefte vil informasjonskapsler for markedsføring og annonsering bli deaktivert.',
    confirmButton: 'Bekreft reservasjon',
    cancelButton: 'Avbryt',
    optedOut: 'Du har reservert deg mot salg av din personlige informasjon.',
  },
};
