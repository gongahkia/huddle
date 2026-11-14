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
