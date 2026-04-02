import { useRef, useEffect, useCallback, useState, useMemo, type FC } from 'react';
import type { CookieConsentConfig, ConsentRecord, ConsentEventDetail } from '../src/core/types.js';

// Register the custom element only once, only in the browser
let registered = false;
if (typeof window !== 'undefined' && !registered) {
  registered = true;
  import('../dist/cookieproof.esm.js');
}

export interface CookieConsentProps extends CookieConsentConfig {
  onConsentUpdate?: (detail: ConsentEventDetail) => void;
  onConsentInit?: (detail: ConsentEventDetail) => void;
  className?: string;
  style?: React.CSSProperties;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'cookie-consent': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export const CookieConsent: FC<CookieConsentProps> = ({
  onConsentUpdate,
  onConsentInit,
  className,
  style,
  ...config
}) => {
  const ref = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Stabilise config reference — prevent infinite rebuild when parent re-renders
  const configJson = JSON.stringify(config);
  const stableConfig = useMemo(() => config, [configJson]);

  // Only render the custom element on the client to prevent SSR hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Single effect: wait for element upgrade, then configure + bind events.
  // Merging prevents the race where event handlers are lost if the element
  // hasn't been upgraded yet when the event-binding effect runs.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cancelled = false;
    const handlers: Array<() => void> = [];
    const timeout = setTimeout(() => {
      console.warn('[cookieproof] <cookie-consent> was not defined within 5s — check that the package is loaded.');
    }, 5000);

    customElements.whenDefined('cookie-consent').then(() => {
      clearTimeout(timeout);
      if (cancelled || !ref.current) return;
      const ce = ref.current as any;

      if (typeof ce.configure === 'function') {
        ce.configure(stableConfig);
      }
      if (typeof ce.on === 'function') {
        if (onConsentUpdate) handlers.push(ce.on('consent:update', onConsentUpdate));
        if (onConsentInit) handlers.push(ce.on('consent:init', onConsentInit));
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      handlers.forEach(unsub => unsub());
    };
  }, [stableConfig, onConsentUpdate, onConsentInit]);

  // Suppress during SSR — custom elements can't render server-side
  if (!mounted) return null;

  return <cookie-consent ref={ref} className={className} style={style} />;
};

/** Hook to access the consent element imperatively */
export function useConsent() {
  const getElement = useCallback((): any | null => {
    if (typeof document === 'undefined') return null;
    return document.querySelector('cookie-consent');
  }, []);

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
