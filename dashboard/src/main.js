import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import App from './App.vue';
import router from './router/index.js';
import './styles.css';

createApp(App)
  .use(createPinia())
  .use(router)
  .mount('#app');
