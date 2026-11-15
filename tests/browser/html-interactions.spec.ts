import {expect,test} from '@playwright/test';
import {hostFixture,openReview} from './fixture';
test('packed core coexists with actual jQuery and htmx, intercepting only deliberate pin selection',async ({page}) => {
  const fixture = hostFixture(); await fixture.attach(page.context()); const errors:string[] = []; page.on('pageerror',error => errors.push(error.message));
  await page.goto('/html/interactions.html?workspace=team');
  expect(await page.evaluate(() => ({jquery:Reflect.get(window,'jQuery').fn.jquery,htmx:Reflect.get(window,'htmx').version}))).toEqual({jquery:'4.0.0',htmx:'2.0.11'});
  await page.getByRole('button',{name:'jQuery update',exact:true}).click(); await expect(page.getByRole('status',{name:''}).filter({hasText:'jQuery updates: 1'})).toBeVisible();
  await page.getByRole('button',{name:'Load htmx fragment',exact:true}).click(); await expect(page.getByRole('heading',{name:'Fragment loaded by htmx',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'jQuery dynamic update',exact:true}).click(); await expect(page.locator('#jquery-count')).toHaveText('jQuery updates: 2');
  const root = await page.locator('[data-huddle-root]').elementHandle(); await openReview(page); await page.getByRole('button',{name:'jQuery update',exact:true}).click(); await expect(page.locator('#jquery-count')).toHaveText('jQuery updates: 3');
  const fragment = page.waitForResponse(response => new URL(response.url()).pathname === '/html/interaction-fragment.html'); await page.getByRole('button',{name:'Load htmx fragment',exact:true}).click(); expect((await fragment).ok()).toBe(true); await expect(page.getByRole('button',{name:'jQuery dynamic update',exact:true})).toBeVisible(); expect(await root!.evaluate(node => node.isConnected)).toBe(true);
  await page.getByRole('button',{name:'Pin a comment',exact:true}).click(); await page.getByRole('button',{name:'jQuery update',exact:true}).click(); await expect(page.getByLabel('Your comment',{exact:true})).toBeVisible(); await expect(page.locator('#jquery-count')).toHaveText('jQuery updates: 3');
  await page.getByLabel('Your comment',{exact:true}).fill('Pinned ordinary HTML'); await page.getByRole('button',{name:'Post comment',exact:true}).click(); await expect(page.getByText('Comment saved.',{exact:true})).toBeVisible(); expect(fixture.records[0].thread.anchor.label).toBe('jQuery update');
  await page.getByRole('button',{name:'Collapse feedback',exact:true}).click(); await page.getByRole('button',{name:'jQuery dynamic update',exact:true}).click(); await expect(page.locator('#jquery-count')).toHaveText('jQuery updates: 4'); expect(errors).toEqual([]);
});
