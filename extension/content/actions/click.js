/**
 * Click Action Handler
 */
window.ActionExecutor.registerHandler('click', async (actionDef, utils) => {
  const el = utils.resolveTarget(actionDef.target);
  if (!el) {
    return { success: false, action: 'click', error: 'TARGET_NOT_FOUND' };
  }
  
  // Smooth scroll into view
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await utils.delay(300); // wait for scroll to settle
  
  utils.highlightElement(el);
  await utils.delay(200); // visual pause
  
  el.click();
  
  return { success: true, action: 'click', targetFound: true };
});
