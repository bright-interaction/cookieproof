import type { TranslationStrings } from '../core/types.js';

export const es: TranslationStrings = {
  banner: {
    title: 'Respetamos su privacidad',
    description:
      'Utilizamos cookies para mejorar su experiencia. Puede elegir qué categorías aceptar.',
    acceptAll: 'Aceptar todo',
    rejectAll: 'Rechazar todo',
    settings: 'Configuración',
    privacyPolicy: 'Política de privacidad',
    doNotSell: 'No vender mis datos',
  },
  preferences: {
    title: 'Configuración de cookies',
    save: 'Guardar preferencias',
    acceptAll: 'Aceptar todo',
    rejectAll: 'Rechazar todo',
    privacyPolicy: 'Política de privacidad',
    moreInfo: 'Más información',
    moreInfoText: 'Utilizamos cookies y tecnologías similares para proporcionar, proteger y mejorar nuestros servicios. Puede gestionar sus preferencias en cualquier momento. Para más detalles sobre cómo procesamos sus datos, consulte nuestra política de privacidad.',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'Proveedor',
    cookieTablePurpose: 'Finalidad',
    cookieTableExpiry: 'Caducidad',
  },
  categories: {
    necessary: {
      label: 'Necesarias',
      description: 'Imprescindibles para el funcionamiento del sitio web. No se pueden desactivar.',
    },
    analytics: {
      label: 'Analíticas',
      description: 'Nos ayudan a entender cómo los visitantes utilizan el sitio web.',
    },
    marketing: {
      label: 'Marketing',
      description: 'Se utilizan para mostrar publicidad relevante.',
    },
    preferences: {
      label: 'Preferencias',
      description: 'Guardan sus ajustes y opciones de personalización.',
    },
  },
  trigger: {
    ariaLabel: 'Configuración de privacidad',
  },
  alwaysOnLabel: 'Siempre activo',
  ccpa: {
    linkText: 'No vender ni compartir mi información personal',
    confirmTitle: 'No vender ni compartir',
    confirmDescription: 'Tiene derecho a rechazar la venta o el intercambio de su información personal. Al confirmar, se desactivarán las cookies de marketing y publicidad.',
    confirmButton: 'Confirmar exclusión',
    cancelButton: 'Cancelar',
    optedOut: 'Ha optado por no participar en la venta de su información personal.',
  },
};
