import {expect,test} from '@playwright/test';
test('emitted core and helper entry points share ownership and cleanup cannot remove a successor',async ({page}) => {
 await page.goto('http://localhost:4321/html/');
 const result = await page.evaluate(async () => {
  const {mount} = await import(new URL('/sdk/huddle.js',location.href).href), {huddle} = await import(new URL('/sdk/svelte.js',location.href).href);
  const {createHttpAdapter} = await import(new URL('/sdk/http.js',location.href).href);
  const options = {adapter:createHttpAdapter(),namespace:'ownership',workspace:'team',environment:'staging'};
  const manual = mount(options); let helperConflict = '', coreConflict = '';
  try {huddle(document.body,options);} catch (error) {helperConflict = (error as Error).message;}
  const manualStillPresent = document.querySelectorAll('[data-huddle-root]').length === 1; manual.destroy();
  const action = huddle(document.body,options);
  try {mount(options);} catch (error) {coreConflict = (error as Error).message;}
  action.destroy(); const successor = mount(options); action.destroy(); const successorStillPresent = document.querySelectorAll('[data-huddle-root]').length === 1; successor.destroy();
  return {helperConflict,coreConflict,manualStillPresent,successorStillPresent,remaining: document.querySelectorAll('[data-huddle-root]').length};
 });
 expect(result.helperConflict).toContain('owned by another integration'); expect(result.coreConflict).toContain('owned by another integration');
 expect(result.manualStillPresent).toBe(true); expect(result.successorStillPresent).toBe(true); expect(result.remaining).toBe(0);
});
