import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ja from './locales/ja.json';

// Get language from URL query parameter or browser setting
const getLanguage = (): string => {
  // Check URL query parameter first (e.g., ?lang=en or ?lang=ja)
  const urlParams = new URLSearchParams(window.location.search);
  const queryLang = urlParams.get('lang');
  if (queryLang && ['en', 'ja'].includes(queryLang)) {
    return queryLang;
  }
  // Fall back to browser language
  const browserLang = navigator.language.split('-')[0];
  return ['en', 'ja'].includes(browserLang) ? browserLang : 'en';
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: getLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
