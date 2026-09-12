/**
 * Type Action Handler
 */
window.ActionExecutor.registerHandler('type', async (actionDef, utils) => {
  const el = utils.resolveTarget(actionDef.target);
  if (!el) {
    return { success: false, action: 'type', error: 'TARGET_NOT_FOUND' };
  }

  if (typeof actionDef.text !== 'string') {
    return { success: false, action: 'type', error: 'INVALID_TEXT_PAYLOAD' };
  }
  
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await utils.delay(300);
  
  utils.highlightElement(el);
  await utils.delay(200);
  
  el.focus();
  
  // Native value setter handles React/Vue controlled inputs better
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter && el instanceof HTMLInputElement) {
    nativeInputValueSetter.call(el, actionDef.text);
  } else {
    el.value = actionDef.text;
  }
  
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { success: true, action: 'type', targetFound: true };
});
