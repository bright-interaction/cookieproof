import { defineComponent, ref, onMounted, onUnmounted, watch, h, type PropType } from 'vue';
import type { CookieConsentConfig, ConsentRecord, ConsentEventDetail } from '../src/core/types.js';

// Ensure the custom element is registered in the browser
if (typeof window !== 'undefined') {
  import('../dist/cookieproof.esm.js');
}

export const CookieConsent = defineComponent({
  name: 'CookieConsent',
  props: {
    config: {
      type: Object as PropType<CookieConsentConfig>,
      default: () => ({}),
    },
  },
  emits: ['consent-update', 'consent-init'],
  setup(props, { emit }) {
    const elRef = ref<any>(null);
    const isMounted = ref(false);
    const isUnmounted = ref(false);
    const unsubscribers: Array<() => void> = [];

    onMounted(() => {
      isMounted.value = true;
      // Wait for the custom element to be upgraded before configuring + binding events
      customElements.whenDefined('cookie-consent').then(() => {
        if (isUnmounted.value) return;
        const el = elRef.value;
        if (!el || typeof el.configure !== 'function') return;

        el.configure(props.config);

        if (typeof el.on === 'function') {
          unsubscribers.push(
            el.on('consent:update', (detail: ConsentEventDetail) => {
              emit('consent-update', detail);
            })
          );
          unsubscribers.push(
            el.on('consent:init', (detail: ConsentEventDetail) => {
              emit('consent-init', detail);
            })
          );
        }
      });
    });

    const stopWatch = watch(
      () => props.config,
      (newConfig) => {
        // Guard: only configure if the element has been upgraded
        customElements.whenDefined('cookie-consent').then(() => {
          if (isUnmounted.value) return;
          const el = elRef.value;
          if (el && typeof el.configure === 'function') {
            el.configure(newConfig);
          }
        });
      },
      { deep: true }
    );

    onUnmounted(() => {
      isUnmounted.value = true;
      stopWatch();
      unsubscribers.forEach(unsub => unsub());
    });

    // Suppress during SSR to prevent hydration mismatch (custom elements need browser APIs)
    return () => isMounted.value ? h('cookie-consent', { ref: elRef }) : null;
  },
});

/** Composable to access the consent element imperatively */
export function useConsent() {
  const getElement = (): any | null => {
    if (typeof document === 'undefined') return null;
    return document.querySelector('cookie-consent');
  };

  return {
    acceptAll: () => getElement()?.acceptAll(),
    rejectAll: () => getElement()?.rejectAll(),
    acceptCategory: (id: string) => getElement()?.acceptCategory(id),
    rejectCategory: (id: string) => getElement()?.rejectCategory(id),
    getConsent: (): ConsentRecord | null => getElement()?.getConsent() ?? null,
    hasConsent: (category: string): boolean => getElement()?.hasConsent(category) ?? false,
    showBanner: () => getElement()?.showBanner(),
    showPreferences: () => getElement()?.showPreferences(),
    hide: () => getElement()?.hide(),
    reset: () => getElement()?.reset(),
  };
}

export default CookieConsent;
