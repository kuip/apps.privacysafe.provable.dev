import { createApp } from 'vue';
import App from '@/App.vue';
import { initThemeSync } from '@/lib/theme';
import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/styles.css';

initThemeSync()
  .catch(err => {
    console.error('Failed to initialize Kayros theme sync.', err);
  })
  .finally(() => {
    createApp(App).mount('#main');
  });
