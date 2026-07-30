import { defineStore } from 'pinia';

let notificationId = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    notifications: []
  }),
  actions: {
    notify({ title, description = '', tone = 'info', duration = 4200 }) {
      const duplicate = this.notifications.find(item => (
        item.title === title &&
        item.description === description &&
        item.tone === tone
      ));
      if (duplicate) return duplicate.id;
      const id = ++notificationId;
      this.notifications.push({ id, title, description, tone, duration });
      if (this.notifications.length > 5) {
        this.notifications.splice(0, this.notifications.length - 5);
      }
      return id;
    },
    dismiss(id) {
      this.notifications = this.notifications.filter(item => item.id !== id);
    }
  }
});
