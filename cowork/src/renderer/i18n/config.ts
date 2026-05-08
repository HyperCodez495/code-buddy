import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import frTranslations from './locales/fr.json';
import zhTranslations from './locales/zh.json';

i18n
  .use(LanguageDetector) // detect browser language
  .use(initReactI18next) // initialize react-i18next
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      fr: {
        translation: frTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
    },
    // Default language — French. Phase d.21 V1.0 ship: this Cowork
    // build targets Patrice (FR-FR) primarily; English + Chinese remain
    // available via the language switcher. Users on en/zh navigators
    // still get their language because LanguageDetector runs first
    // (localStorage → navigator); fallbackLng only kicks in when
    // detection fails or returns an unsupported locale.
    fallbackLng: 'fr',
    supportedLngs: ['en', 'fr', 'zh'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: {
      escapeValue: false, // React already escapes XSS
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
