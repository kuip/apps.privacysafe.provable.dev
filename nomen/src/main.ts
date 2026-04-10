import { createApp } from 'vue';
import {
  i18n,
  I18nOptions,
} from '@v1nt1248/3nclient-lib/plugins';

import { initThemeSync } from '@/lib/theme';
import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/styles.css';

import App from '@/App.vue';

const messages = {
  en: {},
};

initThemeSync()
  .catch(err => {
    console.error('Failed to initialize Nomen theme sync.', err);
  })
  .finally(() => {
    createApp(App)
      .use<I18nOptions>(i18n, { lang: 'en', messages })
      .mount('#main');
  });
