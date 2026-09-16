/**
 * Scroll Action Handler
 */
window.ActionExecutor.registerHandler('scroll', async (actionDef, utils) => {
  const amount = typeof actionDef.amount === 'number' ? actionDef.amount : 500;
  
  if (actionDef.direction === 'up') {
    window.scrollBy({ top: -amount, behavior: 'smooth' });
  } else {
    window.scrollBy({ top: amount, behavior: 'smooth' });
  }
  
  await utils.delay(Math.min(500, amount)); // approximate scroll time
  
  return { success: true, action: 'scroll' };
});
