let queueTail = Promise.resolve();
let activeOperation = null;
let queuedOperations = 0;

export function withDataLock(label, operation) {
  queuedOperations += 1;
  const run = queueTail
    .catch(() => undefined)
    .then(async () => {
      queuedOperations -= 1;
      activeOperation = String(label || 'data-operation');
      try {
        return await operation();
      } finally {
        activeOperation = null;
      }
    });
  queueTail = run.catch(() => undefined);
  return run;
}

export function getDataLockStatus() {
  return { active: activeOperation, queued: queuedOperations };
}

export function waitForDataIdle() {
  return queueTail.catch(() => undefined);
}
