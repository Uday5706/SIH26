/**
 * Wait Action Handler
 */
window.ActionExecutor.registerHandler('wait', async (actionDef, utils) => {
  const duration = typeof actionDef.duration === 'number' ? actionDef.duration : 1000;
  
  // Max safe wait time
  const safeDuration = Math.min(duration, 10000); 
  
  await utils.delay(safeDuration);
  
  return { success: true, action: 'wait', waited: safeDuration };
});
