import type { TranslationStrings } from '../core/types.js';
import { en } from './en.js';
import { sv } from './sv.js';
import { de } from './de.js';
import { fr } from './fr.js';
import { es } from './es.js';
import { nl } from './nl.js';
import { no } from './no.js';
import { da } from './da.js';
import { fi } from './fi.js';
import { pt } from './pt.js';
import { it } from './it.js';
import { pl } from './pl.js';
import { ja } from './ja.js';

const builtIn: Record<string, TranslationStrings> = { en, sv, de, fr, es, nl, no, da, fi, pt, it, pl, ja };

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', sv: 'Svenska', de: 'Deutsch', fr: 'Français',
  es: 'Español', nl: 'Nederlands', no: 'Norsk', da: 'Dansk',
  fi: 'Suomi', pt: 'Português', it: 'Italiano', pl: 'Polski', ja: '日本語',
};

export function getAvailableLanguages(selector: boolean | string[]): string[] {
  if (selector === true) return Object.keys(builtIn);
  if (Array.isArray(selector)) return selector.filter(l => l in builtIn);
  return [];
}

export function resolveTranslations(
  language?: string,
  custom?: Record<string, TranslationStrings>
): TranslationStrings {
  const lang = language ?? detectLanguage();
  const base = lang.split('-')[0]; // 'sv-SE' -> 'sv'

  // Check custom translations first, then built-in, then fallback to English
  return custom?.[lang] ?? custom?.[base] ?? builtIn[lang] ?? builtIn[base] ?? en;
}

export function detectLanguage(): string {
  // 1. HTML lang attribute
  const htmlLang = document.documentElement.lang;
  if (htmlLang) return htmlLang;

  // 2. Browser language
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }

  return 'en';
}
