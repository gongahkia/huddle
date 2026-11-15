import {expect,test} from '@playwright/test';
import {hostFixture,openReview} from './fixture';
test('a committed save can be explicitly retried after reload with its original key',async ({page}) => {
 const fixture = hostFixture(), control = await fixture.attach(page.context()); await page.goto('http://localhost:4321/html/?workspace=team'); await openReview(page);
 await page.getByRole('button',{name:'Page comment',exact:true}).click(); await page.getByLabel('Your comment',{exact:true}).fill('Keep my uncertain save'); control.loseNextSave = true;
 await page.getByRole('button',{name:'Post comment',exact:true}).click(); await expect(page.getByRole('alert')).toContainText('acknowledgement'); expect(fixture.records).toHaveLength(1);
 await page.reload(); await page.getByRole('button',{name:'Expand feedback',exact:true}).click(); await expect(page.getByLabel('Your comment',{exact:true})).toHaveValue('Keep my uncertain save'); await page.getByRole('button',{name:'Post comment',exact:true}).click(); await expect(page.getByText('Comment saved.',{exact:true})).toBeVisible(); expect(fixture.records).toHaveLength(1);
 const writes = fixture.requests.filter(item => item.method === 'POST'); expect(writes).toHaveLength(2); expect(writes[0].input).toEqual(writes[1].input);
});
test('denied host access clears drafts from the rendered panel and has no popup fallback',async ({page}) => {
 const fixture = hostFixture(), control = await fixture.attach(page.context()); let popups = 0; page.on('popup',() => popups++);
 await page.clock.install(); await page.goto('http://localhost:4321/html/?workspace=team'); await openReview(page); await page.getByRole('button',{name:'Page comment',exact:true}).click(); await page.getByLabel('Your comment',{exact:true}).fill('Private text');
 control.allowed = false; await page.clock.fastForward(11000); await expect(page.getByRole('alert')).toContainText('Internal review'); await expect(page.locator('textarea')).toHaveCount(0); expect(popups).toBe(0);
});
test('failed initial host reads recover without requiring page reload',async ({page}) => {
 const fixture = hostFixture(); await fixture.attach(page.context()); let failures = 1;
 await page.route('**/api/huddle/v2/threads?**',async route => {if(failures-- > 0) await route.fulfill({status:503,json:{error:{code:'unavailable',message:'Temporary host failure.'}}}); else await route.fallback();});
 await page.goto('http://localhost:4321/html/?workspace=team'); await page.clock.install(); await page.getByRole('button',{name:'Expand feedback',exact:true}).click(); await expect(page.getByRole('alert')).toContainText('Temporary'); await page.clock.fastForward(2000); await expect(page.getByRole('alert')).toHaveCount(0);
});
