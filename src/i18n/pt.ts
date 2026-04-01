import type { TranslationStrings } from '../core/types.js';

export const pt: TranslationStrings = {
  banner: {
    title: 'Respeitamos a sua privacidade',
    description:
      'Utilizamos cookies para melhorar a sua experiência. Pode escolher quais categorias aceitar.',
    acceptAll: 'Aceitar todos',
    rejectAll: 'Rejeitar todos',
    settings: 'Definições',
    privacyPolicy: 'Política de Privacidade',
    doNotSell: 'Não vender os meus dados',
  },
  preferences: {
    title: 'Definições de cookies',
    save: 'Guardar preferências',
    acceptAll: 'Aceitar todos',
    rejectAll: 'Rejeitar todos',
    privacyPolicy: 'Política de Privacidade',
    moreInfo: 'Saber mais',
    moreInfoText: 'Utilizamos cookies e tecnologias semelhantes para fornecer, proteger e melhorar os nossos serviços. Pode gerir as suas preferências a qualquer momento. Para mais detalhes sobre como processamos os seus dados, consulte a nossa política de privacidade.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Fornecedor',
    cookieTablePurpose: 'Finalidade',
    cookieTableExpiry: 'Expiração',
  },
  categories: {
    necessary: {
      label: 'Necessários',
      description: 'Essenciais para o funcionamento do website. Não podem ser desativados.',
    },
    analytics: {
      label: 'Analíticos',
      description: 'Ajudam-nos a compreender como os visitantes utilizam o website.',
    },
    marketing: {
      label: 'Marketing',
      description: 'Utilizados para apresentar anúncios relevantes.',
    },
    preferences: {
      label: 'Preferências',
      description: 'Memorizam as suas definições e escolhas de personalização.',
    },
  },
  trigger: {
    ariaLabel: 'Definições de privacidade',
  },
  alwaysOnLabel: 'Sempre ativo',
  ccpa: {
    linkText: 'Não vender ou partilhar as minhas informações pessoais',
    confirmTitle: 'Não vender ou partilhar',
    confirmDescription: 'Tem o direito de recusar a venda ou partilha das suas informações pessoais. Ao confirmar, os cookies de marketing e publicidade serão desativados.',
    confirmButton: 'Confirmar recusa',
    cancelButton: 'Cancelar',
    optedOut: 'Recusou a venda das suas informações pessoais.',
  },
};
