import { defineStore } from 'pinia';

let notificationId = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    notifications: []
  }),
  actions: {
    notify({ title, description = '', tone = 'info', duration = 4200 }) {
      const id = ++notificationId;
      this.notifications.push({ id, title, description, tone, duration });
      return id;
    },
    dismiss(id) {
      this.notifications = this.notifications.filter(item => item.id !== id);
    }
  }
});
