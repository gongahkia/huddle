import {expect,test} from '@playwright/test';
import {comment,hostFixture,openReview} from './fixture';
test('two host identities share pins, replies and status through the adapter seam',async ({browser}) => {
 const first = await browser.newContext(), second = await browser.newContext();
 try {
  const fixture = hostFixture(); await fixture.attach(first,{id:'internal:alex',name:'Alex'}); await fixture.attach(second,{id:'internal:morgan',name:'Morgan'});
  const a = await first.newPage(), b = await second.newPage(); await a.clock.install(); await b.clock.install(); await a.goto('http://localhost:4321/html/?workspace=team'); await b.goto('http://localhost:4321/html/?workspace=team'); await openReview(a); await openReview(b);
  await a.getByRole('button',{name:'Pin a comment',exact:true}).click(); await a.locator('#target-copy').click(); await a.getByLabel('Your comment',{exact:true}).fill('Move this copy'); await a.getByRole('button',{name:'Post comment',exact:true}).click(); await expect(a.getByText('Comment saved.',{exact:true})).toBeVisible();
  await b.clock.fastForward(11000); await b.getByRole('button').filter({hasText:'Move this copy'}).click(); await b.getByLabel('Reply',{exact:true}).fill('Morgan reply'); await b.getByRole('button',{name:'Post reply',exact:true}).click(); await expect(b.getByText('Comment saved.',{exact:true})).toBeVisible();
  expect(fixture.records[0].comments.items.map(item => item.author.name)).toEqual(['Alex','Morgan']); await b.getByRole('button',{name:'Resolve thread',exact:true}).click(); await expect(b.getByRole('button',{name:'Reopen thread',exact:true})).toBeVisible();
  await a.clock.fastForward(11000); await expect(a.getByText('Morgan reply',{exact:true})).toBeVisible(); await expect(a.getByRole('button',{name:'Reopen thread',exact:true})).toBeVisible();
 } finally {await first.close(); await second.close();}
});
test('keeps normal browsing intact and handles deliberate selection, Escape, dialogs and mobile layout',async ({page}) => {
 const fixture = hostFixture(); await fixture.attach(page.context()); await page.setViewportSize({width:390,height:720}); await page.goto('http://localhost:4321/html/?workspace=team');
 await page.locator('#save-profile').click(); await expect(page.locator('#save-status')).toHaveText('Profile saved'); await openReview(page);
 await page.getByRole('button',{name:'Pin a comment',exact:true}).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name:'Page comment',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click(); await page.locator('#open-dialog').click(); await openReview(page); await comment(page,'Inside the host dialog'); await expect(page.locator('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click(); await page.locator('#dialog-close').click(); await expect(page.locator('dialog')).not.toBeVisible();
});
test('repeated mount/destroy leaves host history wrappers and widgets clean',async ({page}) => {
 await page.goto('http://localhost:4321/html/');
 const result = await page.evaluate(async () => {
  const {mount} = await import(new URL('/sdk/huddle.js',location.href).href),{createHttpAdapter} = await import(new URL('/sdk/http.js',location.href).href); const adapter = createHttpAdapter(), original = history.pushState;
  for(let index=0;index<100;index++) {const widget=mount({adapter,namespace:'cycles',workspace:'team',environment:'preview'}); history.pushState(null,'',`/html/cycle-${index}`); widget.destroy();}
  return {count:document.querySelectorAll('[data-huddle-root]').length,restored:history.pushState === original};
 }); expect(result).toEqual({count:0,restored:true});
});
test('collapsed review keeps pins, previews, drafts and live updates without covering the page',async ({page,browserName}) => {
 const fixture = hostFixture(), control = await fixture.attach(page.context()); await page.clock.install(); await page.goto('http://localhost:4321/html/?workspace=team'); await openReview(page);
 const note = 'Please shorten this copy. Keep the friendly tone. '+ 'More context for the team. '.repeat(18);
 await page.getByRole('button',{name:'Pin a comment',exact:true}).click(); await page.locator('#target-copy').click(); await page.getByLabel('Your comment',{exact:true}).fill(note); await page.getByRole('button',{name:'Post comment',exact:true}).click(); await expect(page.getByText('Comment saved.',{exact:true})).toBeVisible();
 if(browserName === 'chromium') await page.screenshot({path:'output/browser/ui-thread.png'});
 await page.getByLabel('Reply',{exact:true}).fill('Unsent reply'); await page.getByRole('button',{name:'Collapse feedback',exact:true}).click(); await expect(page.locator('.panel')).toHaveCount(0); await expect(page.locator('[data-huddle-open][data-huddle-collapsed]')).toHaveCount(1); await expect(page.getByRole('button',{name:'Expand feedback',exact:true})).toBeFocused();
 const pin = page.locator('button.pin').first(), tooltip = page.getByRole('tooltip'); await expect(pin).toBeVisible(); await pin.hover(); await expect(tooltip).toContainText('Please shorten this copy.'); expect((await tooltip.locator('p').textContent())!.length).toBeLessThanOrEqual(241); await tooltip.hover(); await page.clock.fastForward(200); await expect(tooltip).toBeVisible(); await page.keyboard.press('Escape'); await expect(tooltip).not.toBeVisible(); await expect(page.locator('[data-huddle-open]')).toHaveCount(1);
 if(browserName === 'chromium') {await pin.hover(); await page.screenshot({path:'output/browser/ui-collapsed-preview.png'});}
 await pin.focus(); await expect(tooltip).toBeVisible(); const pinId = await pin.getAttribute('id'); await page.locator('#save-profile').click(); await expect(page.locator('#save-status')).toHaveText('Profile saved'); await page.getByRole('button',{name:'Expand feedback',exact:true}).click(); await expect(page.getByLabel('Reply',{exact:true})).toHaveValue('Unsent reply');
 await page.getByRole('button',{name:'Collapse feedback',exact:true}).click(); await pin.focus(); await page.clock.fastForward(11000); await expect(page.locator('#'+pinId)).toBeFocused(); await expect(tooltip).toBeVisible();
 await page.setViewportSize({width:320,height:720}); await page.locator('#target-copy').scrollIntoViewIfNeeded(); await pin.focus(); const bounds = await tooltip.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(320); expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(720);
 await pin.click(); await expect(page.getByLabel('Reply',{exact:true})).toHaveValue('Unsent reply'); await expect(page.getByRole('button',{name:'Back to comments',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Collapse feedback',exact:true}).click(); control.allowed = false; await page.clock.fastForward(11000); await expect(page.locator('button.pin')).toHaveCount(0); await expect(tooltip).not.toBeVisible(); await page.getByRole('button',{name:'Expand feedback',exact:true}).click(); await expect(page.locator('textarea')).toHaveCount(0);
 await page.getByRole('button',{name:'Close',exact:true}).click(); await expect(page.locator('[data-huddle-open]')).toHaveCount(0);
});
test('comments on the same element remain individually reachable after picker cancellation',async ({page}) => {
 const fixture = hostFixture(); await fixture.attach(page.context()); await page.goto('http://localhost:4321/html/?workspace=team'); await openReview(page);
 for(const body of ['First shared target','Second shared target','Third shared target']) {
  await page.getByRole('button',{name:'Pin a comment',exact:true}).click(); await page.locator('#target-copy').click(); await page.getByLabel('Your comment',{exact:true}).fill(body); await page.getByRole('button',{name:'Post comment',exact:true}).click(); await expect(page.getByText('Comment saved.',{exact:true})).toBeVisible(); await page.getByRole('button',{name:'Back to comments',exact:true}).click();
 }
 const anchors = structuredClone(fixture.records.map(item => item.thread.anchor)); await page.locator('button.thread').first().click(); await page.getByRole('button',{name:'Reattach pin',exact:true}).click(); await page.getByRole('button',{name:'Cancel',exact:true}).click(); await page.getByRole('button',{name:'Collapse feedback',exact:true}).click();
 for(const record of fixture.records) {
  const pin = page.locator('#huddle-pin-'+record.thread.id); await pin.hover(); await expect(page.getByRole('tooltip')).toContainText(record.thread.latestComment!.body); await pin.click(); await expect(page.locator('article')).toContainText(record.thread.latestComment!.body); await page.getByRole('button',{name:'Collapse feedback',exact:true}).click();
 }
 expect(fixture.records.map(item => item.thread.anchor)).toEqual(anchors); expect(fixture.requests.filter(item => item.method === 'PATCH')).toHaveLength(0);
});
