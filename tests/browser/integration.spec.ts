import {expect,test,type Page} from '@playwright/test';
const server = 'http://127.0.0.1:4311', project = '11111111-1111-4111-8111-111111111111';
const example = `http://localhost:4321/html/?project=${project}&server=${encodeURIComponent(server)}`;
async function login(page: Page) {
  await page.goto(server); await page.getByLabel('Email',{exact: true}).fill('admin@huddle.test'); await page.getByLabel('Password',{exact: true}).fill('huddle-browser-password');
  await page.getByRole('button',{name: 'Sign in',exact: true}).click(); await expect(page.getByRole('heading',{name: 'Feedback inbox',exact: true})).toBeVisible();
}
async function connect(page: Page) {
  await page.getByRole('button',{name: 'Open Huddle',exact: true}).click(); const pending = page.waitForEvent('popup');
  await page.getByRole('button',{name: 'Connect Huddle',exact: true}).click(); const popup = await pending;
  await popup.getByRole('button',{name: 'Allow review access',exact: true}).click(); await expect.poll(() => popup.isClosed()).toBe(true);
}
test('Next.js production SSR hydrates, posts feedback and cleans up across client navigation',async ({page,request}) => {
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message));
  const url = `http://localhost:4322/?project=${project}&server=${encodeURIComponent(server)}`;
  const html = await (await request.get(url)).text(); expect(html).toContain('Next.js server-rendered integration'); expect(html).not.toContain('data-huddle-root');
  await login(page); await page.goto(url); await page.getByRole('button',{name: 'Add update',exact: true}).click(); await expect(page.getByText('Updates: 1',{exact: true})).toBeVisible();
  await connect(page); await page.getByRole('button',{name: 'Page comment',exact: true}).click(); await page.getByLabel('Your comment',{exact: true}).fill('Next.js hydrated feedback');
  await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible();
  await page.getByRole('button',{name: 'Close',exact: true}).click(); await page.getByRole('link',{name: 'Next page',exact: true}).click();
  await expect(page.getByRole('heading',{name: 'Another server-rendered page'})).toBeVisible(); await expect(page.locator('[data-huddle-root]')).toHaveCount(0);
  await page.goBack(); await expect(page.locator('[data-huddle-root]')).toHaveCount(1); expect(errors).toEqual([]);
});
test('a timed-out committed save can be retried after reload without duplicating feedback',async ({page,browserName}) => {
  await login(page); await page.goto(example);
  await page.evaluate(async () => {
    const windowWithReview = window as Window & {review?: import('../../packages/browser/src/index').Huddle}; windowWithReview.review?.destroy();
    const {mount} = await import(new URL('/huddle.js',location.href).href);
    windowWithReview.review = mount({serverUrl: 'http://127.0.0.1:4311',projectId: '11111111-1111-4111-8111-111111111111',environment: 'staging',release: 'html-example-v1',requestTimeoutMs: 400});
  });
  await connect(page); await page.getByRole('button',{name: 'Page comment',exact: true}).click();
  const ids: string[] = []; let threadId = '', release!: () => void; const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/projects/*/threads',async route => {
    if (route.request().method() !== 'POST') return route.continue(); ids.push(route.request().postDataJSON().requestId);
    if (ids.length > 1) return route.continue();
    const response = await route.fetch(); threadId = (await response.json()).id; await held; await route.fulfill({response}).catch(() => {});
  });
  const text = `Lost acknowledgement ${browserName} ${Date.now()}`;
  await page.getByLabel('Your comment',{exact: true}).fill(text); await page.getByRole('button',{name: 'Post comment',exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('timed out'); await expect(page.getByRole('button',{name: 'Post comment',exact: true})).toBeEnabled(); release();
  await page.reload(); await connect(page); await expect(page.getByLabel('Your comment',{exact: true})).toHaveValue(text);
  await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[1]).toBe(ids[0]);
  const detail = await (await page.request.get(`${server}/api/projects/${project}/threads/${threadId}`)).json(); expect(detail.commentCount).toBe(1); expect(detail.comments[0].body).toBe(text);
});
test('failed initial feedback reads recover without disturbing the host page',async ({page}) => {
  await login(page); await page.goto(example); let reads = 0;
  await page.route('**/api/projects/*/threads?*',route => {reads++; return reads < 3 ? route.fulfill({status: 503,body: '<h1>Proxy restarting</h1>',contentType: 'text/html'}) : route.continue();});
  await connect(page); await expect.poll(() => reads,{timeout: 7000}).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('alert')).toHaveCount(0); await page.getByRole('button',{name: 'Close',exact: true}).click();
  await page.locator('#save-profile').click(); await expect(page.locator('#save-status')).toHaveText('Profile saved');
});
test('changing environment cancels an outstanding authorization popup',async ({page}) => {
  await login(page); await page.goto(example); await page.getByRole('button',{name: 'Open Huddle',exact: true}).click();
  const pending = page.waitForEvent('popup'); await page.getByRole('button',{name: 'Connect Huddle',exact: true}).click(); const popup = await pending;
  await expect(popup.getByRole('button',{name: 'Allow review access',exact: true})).toBeVisible();
  await page.evaluate(() => (window as Window & {review?: import('../../packages/browser/src/index').Huddle}).review!.updateContext({environment: 'production'}));
  await expect.poll(() => popup.isClosed()).toBe(true); await expect(page.getByRole('button',{name: 'Connect Huddle',exact: true})).toBeVisible();
  await expect(page.locator('[data-huddle-root]')).toHaveCount(1); await expect(page.getByText('production',{exact: true})).toBeVisible();
});
test('conflicting installs fail clearly and faulty host callbacks cannot break navigation',async ({page}) => {
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message)); await page.goto('http://localhost:4321/html/');
  const result = await page.evaluate(async () => {
    const {mount} = await import(new URL('/huddle.js',location.href).href);
    const options = {serverUrl: 'http://127.0.0.1:4311',projectId: '11111111-1111-4111-8111-111111111111',environment: 'staging',pageIdentity() {throw new Error('Broken route mapper');},onError() {throw new Error('Broken diagnostics');}};
    const review = mount(options); let conflict = '';
    try {mount({...options,projectId: 'different-project'});} catch (error) {conflict = (error as Error).message;}
    history.pushState(null,'','/html/host-navigation'); const active = document.querySelectorAll('[data-huddle-root]').length; review.destroy(); return {conflict,active};
  });
  expect(result.conflict).toContain('different settings'); expect(result.active).toBe(1); await expect(page).toHaveURL(/host-navigation$/); expect(errors).toEqual([]);
});
