import type { TranslationStrings } from '../core/types.js';

export const sv: TranslationStrings = {
  banner: {
    title: 'Vi respekterar din integritet',
    description:
      'Vi använder cookies för att förbättra din upplevelse. Du kan välja vilka kategorier du godkänner.',
    acceptAll: 'Godkänn alla',
    rejectAll: 'Avvisa alla',
    settings: 'Inställningar',
    privacyPolicy: 'Integritetspolicy',
    doNotSell: 'Sälj inte min info',
  },
  preferences: {
    title: 'Cookieinställningar',
    save: 'Spara inställningar',
    acceptAll: 'Godkänn alla',
    rejectAll: 'Avvisa alla',
    privacyPolicy: 'Integritetspolicy',
    moreInfo: 'Läs mer',
    moreInfoText: 'Vi använder cookies och liknande tekniker för att tillhandahålla, skydda och förbättra våra tjänster. Du kan hantera dina inställningar när som helst. För mer information om hur vi behandlar dina uppgifter, vänligen läs vår integritetspolicy.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Leverantör',
    cookieTablePurpose: 'Syfte',
    cookieTableExpiry: 'Livslängd',
  },
  categories: {
    necessary: {
      label: 'Nödvändiga',
      description: 'Krävs för att webbplatsen ska fungera korrekt. Kan inte inaktiveras.',
    },
    analytics: {
      label: 'Analys',
      description: 'Hjälper oss förstå hur besökare använder webbplatsen.',
    },
    marketing: {
      label: 'Marknadsföring',
      description: 'Används för att visa relevanta annonser.',
    },
    preferences: {
      label: 'Preferenser',
      description: 'Sparar dina val och anpassningar.',
    },
  },
  trigger: {
    ariaLabel: 'Integritetsinställningar',
  },
  alwaysOnLabel: 'Alltid aktiv',
  gpcNotice: 'Global Privacy Control-signal upptäckt — icke-nödvändiga cookies har blockerats.',
  expiryNotice: 'Dina cookieinställningar går ut om {days} dagar. Vänligen granska dina val.',
  ccpa: {
    linkText: 'Sälj inte min personliga information',
    confirmTitle: 'Sälj inte eller dela',
    confirmDescription: 'Du har rätt att välja bort försäljning eller delning av din personliga information. Genom att bekräfta inaktiveras marknadsförings- och reklamcookies.',
    confirmButton: 'Bekräfta',
    cancelButton: 'Avbryt',
    optedOut: 'Du har valt bort försäljning av din personliga information.',
  },
};
