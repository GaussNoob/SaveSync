import { createRouter, createWebHashHistory } from 'vue-router';

const Overview = () => import('../views/Overview.vue');
const Library = () => import('../views/Library.vue');
const History = () => import('../views/History.vue');
const Conflicts = () => import('../views/Conflicts.vue');
const Settings = () => import('../views/Settings.vue');

export const routes = [
  { path: '/', name: 'overview', component: Overview, meta: { title: 'Visão geral', description: 'Estado da sincronização e atividade recente.', icon: 'overview' } },
  { path: '/library', name: 'library', component: Library, meta: { title: 'Jogos', description: 'Fontes de save detectadas e monitoradas.', icon: 'games' } },
  { path: '/conflicts', name: 'conflicts', component: Conflicts, meta: { title: 'Conflitos', description: 'Compare e resolva versões divergentes.', icon: 'conflicts' } },
  { path: '/history', name: 'history', component: History, meta: { title: 'Histórico', description: 'Versões arquivadas e pontos de restauração.', icon: 'history' } },
  { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Configurações', description: 'Nuvem, Syncthing e preferências locais.', icon: 'settings' } }
];

export default createRouter({
  history: createWebHashHistory(),
  routes
});
