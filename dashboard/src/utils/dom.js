/**
 * True when the event target is a field the user is typing into, so global
 * keyboard shortcuts can bail out instead of stealing the keystroke.
 */
export function isEditableTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}
