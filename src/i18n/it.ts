import type { TranslationStrings } from '../core/types.js';

export const it: TranslationStrings = {
  banner: {
    title: 'Rispettiamo la tua privacy',
    description:
      'Utilizziamo i cookie per migliorare la tua esperienza. Puoi scegliere quali categorie accettare.',
    acceptAll: 'Accetta tutti',
    rejectAll: 'Rifiuta tutti',
    settings: 'Impostazioni',
    privacyPolicy: 'Informativa sulla privacy',
    doNotSell: 'Non vendere i miei dati',
  },
  preferences: {
    title: 'Impostazioni dei cookie',
    save: 'Salva preferenze',
    acceptAll: 'Accetta tutti',
    rejectAll: 'Rifiuta tutti',
    privacyPolicy: 'Informativa sulla privacy',
    moreInfo: 'Scopri di più',
    moreInfoText: 'Utilizziamo cookie e tecnologie simili per fornire, proteggere e migliorare i nostri servizi. Puoi gestire le tue preferenze in qualsiasi momento. Per maggiori dettagli su come trattiamo i tuoi dati, consulta la nostra informativa sulla privacy.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Fornitore',
    cookieTablePurpose: 'Scopo',
    cookieTableExpiry: 'Scadenza',
  },
  categories: {
    necessary: {
      label: 'Necessari',
      description: 'Essenziali per il funzionamento del sito web. Non possono essere disattivati.',
    },
    analytics: {
      label: 'Analitici',
      description: 'Ci aiutano a capire come i visitatori utilizzano il sito.',
    },
    marketing: {
      label: 'Marketing',
      description: 'Utilizzati per mostrare annunci pertinenti.',
    },
    preferences: {
      label: 'Preferenze',
      description: 'Ricordano le tue impostazioni e le scelte di personalizzazione.',
    },
  },
  trigger: {
    ariaLabel: 'Impostazioni sulla privacy',
  },
  alwaysOnLabel: 'Sempre attivo',
  ccpa: {
    linkText: 'Non vendere o condividere le mie informazioni personali',
    confirmTitle: 'Non vendere o condividere',
    confirmDescription: 'Hai il diritto di opporti alla vendita o condivisione delle tue informazioni personali. Confermando, i cookie di marketing e pubblicità saranno disattivati.',
    confirmButton: 'Conferma opposizione',
    cancelButton: 'Annulla',
    optedOut: 'Hai scelto di non vendere le tue informazioni personali.',
  },
};
