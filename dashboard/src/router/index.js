import { createRouter, createWebHashHistory } from 'vue-router';
import Overview from '../views/Overview.vue';
import Library from '../views/Library.vue';
import History from '../views/History.vue';
import Conflicts from '../views/Conflicts.vue';
import Settings from '../views/Settings.vue';

export const routes = [
  { path: '/', name: 'overview', component: Overview, meta: { title: 'Visão geral', description: 'Estado da sincronização e atividade recente.', icon: 'grid' } },
  { path: '/library', name: 'library', component: Library, meta: { title: 'Biblioteca', description: 'Jogos, emuladores e fontes monitoradas.', icon: 'library' } },
  { path: '/history', name: 'history', component: History, meta: { title: 'Histórico', description: 'Eventos e versões arquivadas.', icon: 'clock' } },
  { path: '/conflicts', name: 'conflicts', component: Conflicts, meta: { title: 'Conflitos', description: 'Resolução de saves divergentes.', icon: 'alert' } },
  { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Configurações', description: 'Nuvem, Syncthing e preferências.', icon: 'settings' } }
];

export default createRouter({
  history: createWebHashHistory(),
  routes
});
