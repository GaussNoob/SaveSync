import { describe, expect, it } from 'vitest';
import { withDataLock } from '../server/sync-coordinator.js';

describe('sync coordinator', () => {
  it('serializes overlapping mutations', async () => {
    const order = [];
    let releaseFirst;
    let markFirstStarted;
    const gate = new Promise(resolve => { releaseFirst = resolve; });
    const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
    const first = withDataLock('first', async () => {
      order.push('first:start');
      markFirstStarted();
      await gate;
      order.push('first:end');
    });
    const second = withDataLock('second', async () => {
      order.push('second:start');
      order.push('second:end');
    });
    await firstStarted;
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});
