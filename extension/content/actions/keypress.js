/**
 * Keypress Action Handler
 */
window.ActionExecutor.registerHandler('keypress', async (actionDef, utils) => {
  if (!actionDef.key) {
    return { success: false, action: 'keypress', error: 'MISSING_KEY' };
  }
  
  // Dispatch a keyboard event on the currently focused element, or body
  const target = document.activeElement || document.body;
  
  // Example map for 'ENTER'
  let key = actionDef.key;
  let code = actionDef.key;
  let keyCode = 0;

  if (actionDef.key.toUpperCase() === 'ENTER') {
    key = 'Enter';
    code = 'Enter';
    keyCode = 13;
  }
  
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code, keyCode, bubbles: true }));
  await utils.delay(50);
  target.dispatchEvent(new KeyboardEvent('keyup', { key, code, keyCode, bubbles: true }));
  
  // Special case: if it's ENTER and target is an input inside a form, try to submit it
  if (key === 'Enter' && target.tagName === 'INPUT' && target.form) {
      // Small delay to allow listeners to preventDefault if they want
      await utils.delay(100);
      target.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  return { success: true, action: 'keypress' };
});
