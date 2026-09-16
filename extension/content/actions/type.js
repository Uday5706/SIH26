/**
 * Type Action Handler
 */
window.ActionExecutor.registerHandler('type', async (actionDef, utils) => {
  const el = utils.resolveTarget(actionDef.target);
  if (!el) {
    return { success: false, action: 'type', error: 'TARGET_NOT_FOUND' };
  }

  let textToType = actionDef.value !== undefined ? actionDef.value : actionDef.text;
  
  if (typeof textToType !== 'string') {
    return { success: false, action: 'type', error: 'INVALID_TEXT_PAYLOAD' };
  }
  
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await utils.delay(300);
  
  utils.highlightElement(el);
  await utils.delay(200);
  
  el.focus();
  
  // Check if text maps to an original value in the SentraTokenVault (fallback if ActionGuard didn't resolve)
  if (window.SentraTokenVault && window.SentraTokenVault.resolveIfToken) {
    textToType = window.SentraTokenVault.resolveIfToken(textToType);
    
    // Check by element sentra-id if token didn't resolve
    const sentraId = el.getAttribute('data-sentra-id');
    if (sentraId) {
      const resolvedFromId = window.SentraTokenVault.resolve(sentraId);
      if (resolvedFromId !== null && resolvedFromId !== '') {
        textToType = resolvedFromId;
      }
    }
  } else if (window.SentraPrivacyVault) {
    // Legacy fallback
    const resolvedFromToken = window.SentraPrivacyVault.resolveValue(textToType, null);
    if (resolvedFromToken !== null) {
      textToType = resolvedFromToken;
    }
  }

  // Native value setter handles React/Vue controlled inputs better
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter && el instanceof HTMLInputElement) {
    nativeInputValueSetter.call(el, textToType);
  } else {
    el.value = textToType;
  }
  
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { success: true, action: 'type', targetFound: true };
});
