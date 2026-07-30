import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from '../dashboard/src/stores/ui.js';

describe('notification store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('deduplicates identical notifications and bounds the visible queue', () => {
    const store = useUiStore();
    const first = store.notify({ title: 'Falha', description: 'Mesmo erro', tone: 'error' });
    const duplicate = store.notify({ title: 'Falha', description: 'Mesmo erro', tone: 'error' });

    expect(duplicate).toBe(first);
    expect(store.notifications).toHaveLength(1);

    for (let index = 0; index < 7; index += 1) {
      store.notify({ title: `Evento ${index}` });
    }
    expect(store.notifications).toHaveLength(5);
    expect(store.notifications.map(item => item.title)).toEqual([
      'Evento 2',
      'Evento 3',
      'Evento 4',
      'Evento 5',
      'Evento 6'
    ]);
  });
});
