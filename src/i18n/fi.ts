import type { TranslationStrings } from '../core/types.js';

export const fi: TranslationStrings = {
  banner: {
    title: 'Kunnioitamme yksityisyyttäsi',
    description:
      'Käytämme evästeitä parantaaksemme kokemustasi. Voit valita, mitkä kategoriat hyväksyt.',
    acceptAll: 'Hyväksy kaikki',
    rejectAll: 'Hylkää kaikki',
    settings: 'Asetukset',
    privacyPolicy: 'Tietosuojakäytäntö',
    doNotSell: 'Älä myy tietojani',
  },
  preferences: {
    title: 'Evästeasetukset',
    save: 'Tallenna asetukset',
    acceptAll: 'Hyväksy kaikki',
    rejectAll: 'Hylkää kaikki',
    privacyPolicy: 'Tietosuojakäytäntö',
    moreInfo: 'Lue lisää',
    moreInfoText: 'Käytämme evästeitä ja vastaavia teknologioita palveluidemme tarjoamiseen, suojaamiseen ja parantamiseen. Voit hallita asetuksiasi milloin tahansa. Lisätietoja tietojesi käsittelystä löydät tietosuojakäytännöstämme.',
    cookieTableName: 'Eväste',
    cookieTableProvider: 'Tarjoaja',
    cookieTablePurpose: 'Tarkoitus',
    cookieTableExpiry: 'Vanhenee',
  },
  categories: {
    necessary: {
      label: 'Välttämättömät',
      description: 'Välttämättömiä sivuston toiminnalle. Ei voi poistaa käytöstä.',
    },
    analytics: {
      label: 'Analytiikka',
      description: 'Auttavat meitä ymmärtämään, miten kävijät käyttävät sivustoa.',
    },
    marketing: {
      label: 'Markkinointi',
      description: 'Käytetään olennaisten mainosten näyttämiseen.',
    },
    preferences: {
      label: 'Mieltymykset',
      description: 'Muistavat asetuksesi ja mukautusvalintasi.',
    },
  },
  trigger: {
    ariaLabel: 'Tietosuoja-asetukset',
  },
  alwaysOnLabel: 'Aina aktiivinen',
  ccpa: {
    linkText: 'Älä myy tai jaa henkilötietojani',
    confirmTitle: 'Älä myy tai jaa',
    confirmDescription: 'Sinulla on oikeus kieltäytyä henkilötietojesi myynnistä tai jakamisesta. Vahvistamalla markkinointi- ja mainosevästeet poistetaan käytöstä.',
    confirmButton: 'Vahvista kieltäytyminen',
    cancelButton: 'Peruuta',
    optedOut: 'Olet kieltäytynyt henkilötietojesi myynnistä.',
  },
};
