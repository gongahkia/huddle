import {expect, test, type Page} from '@playwright/test';
const server = 'http://127.0.0.1:4311', project = '11111111-1111-4111-8111-111111111111';
const example = (kind = 'html') => `http://localhost:4321/${kind}/?project=${project}&server=${encodeURIComponent(server)}`;
test('local hostname redirects preserve connection parameters and invitation fragments',async ({page}) => {
 await page.goto('http://localhost:4311/connect?project=example&environment=staging#review');
 await expect(page).toHaveURL(`${server}/connect?project=example&environment=staging#review`);
 await expect(page.getByRole('heading',{name: 'Good work starts with a conversation.'})).toBeVisible();
 const invitation = page.waitForRequest(request => request.url() === `${server}/api/auth/invitation`);
 await page.goto('http://localhost:4311/invite#synthetic-invitation-token');
 expect((await invitation).postDataJSON()).toEqual({token: 'synthetic-invitation-token'});
 await expect(page).toHaveURL(`${server}/invite`);
});
async function login(page: Page, member = false) {await page.goto(server); await page.getByLabel('Email',{exact: true}).fill(member ? 'member@huddle.test' : 'admin@huddle.test'); await page.getByLabel('Password',{exact: true}).fill(member ? 'huddle-member-password' : 'huddle-browser-password'); await page.getByRole('button',{name: 'Sign in',exact: true}).click(); await expect(page.getByRole('heading',{name: 'Feedback inbox',exact: true})).toBeVisible();}
async function connect(page: Page) {
 await page.getByRole('button',{name: 'Open Huddle',exact: true}).click();
 const popupPromise = page.waitForEvent('popup'); await page.getByRole('button',{name: 'Connect Huddle',exact: true}).click(); const popup = await popupPromise;
 await expect(popup.getByRole('heading',{name: 'Connect this website'})).toBeVisible(); await popup.getByRole('button',{name: 'Allow review access'}).click();
 await expect(page.getByRole('button',{name: 'Pin a comment',exact: true}).or(page.getByRole('button',{name: 'Back to comments',exact: true}))).toBeVisible();
}
test('two reviewers pin, reply, mention, assign, resolve/reopen and export hostile text safely',async ({browser}) => {
 const a = await browser.newContext(), b = await browser.newContext();
 try {
  const p = await a.newPage(), q = await b.newPage(); await login(p); await login(q,true); await p.goto(example()); await q.goto(example()); await connect(p); await connect(q);
  await p.getByRole('button',{name: 'Pin a comment',exact: true}).click(); await p.locator('#save-profile').click();
  await expect(p.locator('#save-status')).toHaveText('');
  const unique = `Review ${Date.now()} <img src=x onerror="window.huddlePwned=true">`, reply = `I can take this change. ${Date.now()}`;
  await p.getByLabel('Your comment',{exact: true}).fill(unique); await p.getByRole('checkbox',{name: 'Morgan Designer',exact: true}).check(); await p.getByRole('button',{name: 'Post comment',exact: true}).click();
  await expect(p.getByText('Comment saved.',{exact: true})).toBeVisible(); await expect(q.getByText(unique,{exact: true})).toBeVisible(); await expect(q.getByText('Mentioned you · New',{exact: true})).toBeVisible();
  await q.getByRole('button').filter({hasText: unique}).click(); await q.getByLabel('Reply',{exact: true}).fill(reply); await q.getByRole('button',{name: 'Post reply',exact: true}).click();
  await expect(p.getByText(reply,{exact: true})).toBeVisible(); await p.getByRole('combobox',{name: 'Assignee',exact: true}).selectOption('22222222-2222-4222-8222-222222222222');
  await p.getByRole('button',{name: 'Resolve thread',exact: true}).click(); await expect(p.getByRole('button',{name: 'Reopen thread',exact: true})).toBeVisible(); await p.getByRole('button',{name: 'Reopen thread',exact: true}).click();
  expect(await p.evaluate(() => 'huddlePwned' in window)).toBe(false);
  await p.goto(server); await p.locator('.thread-card').filter({hasText: reply}).click(); await expect(p.getByRole('region',{name: 'Thread discussion'}).getByText(reply,{exact: true})).toBeVisible();
  const downloadPromise = p.waitForEvent('download'); await p.getByRole('button',{name: 'Export JSON',exact: true}).click(); const download = await downloadPromise; const stream = await download.createReadStream(); let text = ''; for await (const part of stream!) text += part.toString(); const data = JSON.parse(text); expect(data.complete).toBe(true); const thread = data.threads.find((t: {comments: {body: string}[]}) => t.comments.some(c => c.body === unique)); expect(thread.assigneeId).toBe('22222222-2222-4222-8222-222222222222'); expect(thread.comments).toHaveLength(2);
 } finally {await a.close(); await b.close();}
});
test('recovers drafts after reload, handles moved/missing targets, reattaches and cancels selection',async ({page}) => {
 await login(page); await page.goto(example()); await connect(page);
 await page.getByRole('button',{name: 'Pin a comment',exact: true}).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name: 'Page comment',exact: true})).toBeVisible();
 await page.getByRole('button',{name: 'Pin a comment',exact: true}).click(); await page.locator('#target-copy').click(); await page.getByLabel('Your comment',{exact: true}).fill('A draft worth keeping'); await page.reload();
 await connect(page); await expect(page.getByLabel('Your comment',{exact: true})).toHaveValue('A draft worth keeping'); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible();
 await page.locator('#target-copy').evaluate(el => el.remove()); await page.getByRole('button',{name: 'Locate on page',exact: true}).click(); await expect(page.getByText('Target missing. Open the original view or reattach this pin.',{exact: true}).first()).toBeVisible();
 await page.getByRole('button',{name: 'Reattach pin',exact: true}).click(); await page.locator('#billing h2').click(); await expect(page.getByRole('heading',{name: 'Billing',exact: true}).last()).toBeVisible();
 await page.getByRole('button',{name: 'Close',exact: true}).click(); await page.locator('#save-profile').click(); await expect(page.locator('#save-status')).toHaveText('Profile saved');
});
for (const kind of ['react','angular','vue','svelte','preact','solid']) test(`${kind} uses the same widget while host interactions keep working`,async ({page}) => {
 await login(page); await page.goto(example(kind)); await page.getByRole('button',{name: 'Add update',exact: true}).click(); await expect(page.getByText('Updates: 1',{exact: true})).toBeVisible(); await connect(page); await page.getByRole('button',{name: 'Page comment',exact: true}).click(); await page.getByLabel('Your comment',{exact: true}).fill(`${kind} shared engine`); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible();
 if (['vue','svelte','preact','solid'].includes(kind)) {
  await page.getByRole('button',{name: 'Remove Huddle integration',exact: true}).click(); await expect(page.locator('[data-huddle-root]')).toHaveCount(0);
  await page.getByRole('button',{name: 'Add update',exact: true}).click(); await expect(page.getByText('Updates: 2',{exact: true})).toBeVisible();
  await page.getByRole('button',{name: 'Mount Huddle integration',exact: true}).click(); await expect(page.locator('[data-huddle-root]')).toHaveCount(1); await connect(page);
 }
});
test('native dialogs, scroll, SPA navigation and small viewports remain usable',async ({page}) => {
 await login(page); await page.goto(example()); await connect(page); await page.getByRole('button',{name: 'Close',exact: true}).click(); await page.locator('#open-dialog').click();
 await page.getByRole('button',{name: 'Open Huddle',exact: true}).click(); await page.getByRole('button',{name: 'Pin a comment',exact: true}).click(); await page.locator('dialog h2').click(); await page.getByLabel('Your comment',{exact: true}).fill('Inside the dialog'); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible(); await page.getByRole('button',{name: 'Close',exact: true}).click(); await page.locator('#dialog-close').click();
 await page.locator('#navigate').click(); await page.getByRole('button',{name: 'Open Huddle',exact: true}).click(); await page.setViewportSize({width: 390,height: 844}); await expect(page.getByRole('complementary',{name: 'Huddle feedback'})).toBeVisible(); await page.getByRole('button',{name: 'Page comment',exact: true}).click(); await expect(page.getByLabel('Your comment',{exact: true})).toBeVisible();
});
test('guest invitation grants scoped review access and revocation closes the live session',async ({browser}) => {
 const admin = await browser.newContext(), guest = await browser.newContext();
 try {
  const p = await admin.newPage(); await login(p); await p.getByRole('button',{name: 'Project setup'}).click(); await p.getByRole('button',{name: 'Create invitation',exact: true}).click(); const url = await p.getByRole('textbox',{name: 'Invitation link',exact: true}).inputValue();
  const q = await guest.newPage(); await q.goto(url); await q.getByLabel('Your name',{exact: true}).fill('Invited tester'); await q.getByRole('button',{name: 'Join project',exact: true}).click(); await expect(q.getByRole('heading',{name: 'Feedback inbox',exact: true})).toBeVisible(); expect(q.url()).not.toContain('#');
  await q.goto(example()); await connect(q); await q.getByRole('button',{name: 'Page comment',exact: true}).click(); await q.getByLabel('Your comment',{exact: true}).fill('Guest observation'); await q.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(q.getByText('Comment saved.',{exact: true})).toBeVisible(); await expect(q.getByRole('button',{name: 'Resolve thread',exact: true})).toHaveCount(0);
  await p.getByRole('button',{name: 'Revoke',exact: true}).first().click(); await expect(q.getByRole('button',{name: 'Connect Huddle',exact: true})).toBeVisible(); await expect(q.getByText('Guest observation',{exact: true})).toHaveCount(0);
 } finally {await admin.close(); await guest.close();}
});
test('a save retry keeps the same request and preserves text typed while the first response is in flight',async ({page}) => {
 await login(page); await page.goto(example()); await connect(page); await page.getByRole('button',{name: 'Page comment',exact: true}).click();
 let posted = false; let release!: () => void; const held = new Promise<void>(resolve => {release = resolve;}); const requests: string[] = [];
 await page.route('**/api/projects/*/threads',async route => {
  if (route.request().method() !== 'POST') return route.continue();
  requests.push(route.request().postDataJSON().requestId); const response = await route.fetch();
  if (!posted) {posted = true; await held; return route.abort('failed');} await route.fulfill({response});
 });
 await page.getByLabel('Your comment',{exact: true}).fill('Original note'); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect.poll(() => posted).toBe(true);
 await page.getByLabel('Your comment',{exact: true}).fill('Original note plus another thought'); release(); await expect(page.getByRole('button',{name: 'Post comment',exact: true})).toBeEnabled();
 // Editing the body makes a new save, so verify its text survives the failed response first.
 await expect(page.getByLabel('Your comment',{exact: true})).toHaveValue('Original note plus another thought');
 await page.getByLabel('Your comment',{exact: true}).fill('Original note'); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible(); expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]);
});
test('mount/destroy and SPA cycles release nodes, listeners and history wrappers',async ({page,browserName}) => {
 test.skip(browserName !== 'chromium','Heap/listener metrics require the Chromium DevTools protocol.');
 await page.goto(example()); const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
 await page.evaluate(async () => {const w = window as Window & {review?: import('../../packages/browser/src/index').Huddle}; w.review?.destroy(); delete w.review; await import(new URL('/huddle.js',location.href).href);});
 const metrics = async () => {await cdp.send('HeapProfiler.collectGarbage'); const result = await cdp.send('Performance.getMetrics'); return Object.fromEntries(result.metrics.map(m => [m.name,m.value]));};
 await expect(page.locator('[data-huddle-root]')).toHaveCount(0);
 const baseline = await metrics();
 await page.evaluate(async () => {const {mount} = await import(new URL('/huddle.js',location.href).href); for (let i = 0; i < 100; i++) {const a = mount({serverUrl: 'http://127.0.0.1:4311',projectId: '11111111-1111-4111-8111-111111111111',environment: 'staging'}); if (mount({serverUrl: 'http://127.0.0.1:4311',projectId: '11111111-1111-4111-8111-111111111111',environment: 'staging'}) !== a) throw new Error('Duplicate mount'); a.open(); history.pushState(null,'',`/html/cycle-${i}`); a.close(); a.destroy();}});
 await expect(page.locator('[data-huddle-root]')).toHaveCount(0); const final = await metrics(); expect(final.JSEventListeners - baseline.JSEventListeners).toBeLessThanOrEqual(2); expect(final.Nodes - baseline.Nodes).toBeLessThanOrEqual(10); expect(final.JSHeapUsedSize - baseline.JSHeapUsedSize).toBeLessThan(2 * 1024 * 1024); await cdp.detach();
});
test('successful slow saves retain subsequent edits and failed offline saves keep recoverable drafts',async ({page}) => {
 await login(page); await page.goto(example()); await connect(page); await page.getByRole('button',{name: 'Page comment',exact: true}).click();
 let release!: () => void; const held = new Promise<void>(resolve => {release = resolve;}); let received = false;
 await page.route('**/api/projects/*/threads',async route => {if (route.request().method() !== 'POST') return route.continue(); const response = await route.fetch(); received = true; await held; await route.fulfill({response});});
 await page.getByLabel('Your comment',{exact: true}).fill('First thought'); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect.poll(() => received).toBe(true);
 await page.getByLabel('Your comment',{exact: true}).fill('First thought and a second thought'); release(); await expect(page.getByLabel('Reply',{exact: true})).toHaveValue('and a second thought');
 await page.unroute('**/api/projects/*/threads'); await page.context().setOffline(true); await page.getByRole('button',{name: 'Post reply',exact: true}).click(); await expect(page.getByRole('button',{name: 'Post reply',exact: true})).toBeEnabled(); await expect(page.getByLabel('Reply',{exact: true})).toHaveValue('and a second thought');
 await page.context().setOffline(false); await page.getByRole('button',{name: 'Post reply',exact: true}).click(); await expect(page.getByLabel('Reply',{exact: true})).toHaveValue(''); await expect(page.getByText('and a second thought',{exact: true})).toBeVisible();
});
test('ignores an older page response after SPA navigation and can pin native popover content',async ({page}) => {
 await login(page); await page.goto(example()); await connect(page); await page.getByRole('button',{name: 'Page comment',exact: true}).click(); await page.getByLabel('Your comment',{exact: true}).fill('Only on the original page'); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await expect(page.getByText('Comment saved.',{exact: true})).toBeVisible(); await page.getByRole('button',{name: 'Back to comments',exact: true}).click();
 let held = false, release!: () => void, fulfilled!: () => void; const waiting = new Promise<void>(resolve => {release = resolve;}); const completed = new Promise<void>(resolve => {fulfilled = resolve;});
 await page.route('**/api/projects/*/threads?*',async route => {if (!held) {held = true; const response = await route.fetch(); await waiting; await route.fulfill({response}); fulfilled();} else await route.continue();});
 await page.getByRole('button',{name: 'Close',exact: true}).click(); await page.getByRole('button',{name: 'Open Huddle',exact: true}).click(); await expect.poll(() => held).toBe(true); await page.evaluate(() => history.pushState(null,'','/html/new-route'));
 await expect(page.getByText('No feedback here yet. Start a discussion.',{exact: true})).toBeVisible(); release(); await completed; await page.unroute('**/api/projects/*/threads?*'); await expect(page.getByText('Only on the original page',{exact: true})).toHaveCount(0);
 await page.evaluate(() => {const pop = document.createElement('div'); pop.id = 'test-popover'; pop.setAttribute('popover','manual'); pop.innerHTML = '<h2>Popover preferences</h2>'; document.body.append(pop); pop.showPopover();});
 await page.getByRole('button',{name: 'Pin a comment',exact: true}).click(); await page.locator('#test-popover h2').click(); await expect(page.getByLabel('Your comment',{exact: true})).toBeVisible();
});
test('authenticated lifecycle cycles close their SSE connections',async ({page}) => {
 await login(page); await page.goto(example()); const exchangePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/exchange'));
 await connect(page); const {token} = await (await exchangePromise).json();
 const active = new Set<import('@playwright/test').Request>();
 page.on('request',request => {if (request.url().includes('/events?')) active.add(request);}); page.on('requestfinished',request => active.delete(request)); page.on('requestfailed',request => active.delete(request));
 await page.evaluate(() => {const w = window as Window & {review?: import('../../packages/browser/src/index').Huddle}; w.review?.destroy(); delete w.review;});
 for (let i = 0; i < 10; i++) {
  const opened = page.waitForResponse(response => response.url().includes('/events?'));
  await page.evaluate(async ({token}) => {const {mount} = await import(new URL('/huddle.js',location.href).href); const w = window as Window & {review?: import('../../packages/browser/src/index').Huddle}; w.review = mount({serverUrl: 'http://127.0.0.1:4311',projectId: '11111111-1111-4111-8111-111111111111',environment: 'staging',accessToken: token}); w.review!.open();},{token});
  await opened;
  await page.evaluate(() => {const w = window as Window & {review?: import('../../packages/browser/src/index').Huddle}; w.review?.destroy(); delete w.review;});
  await expect.poll(() => active.size).toBe(0);
 }
 await expect(page.locator('[data-huddle-root]')).toHaveCount(0);
});
test('an administrator configures a new project through the management interface',async ({page}) => {
 await login(page); await page.getByRole('button',{name: 'Project setup'}).click(); await page.getByLabel('Project name',{exact: true}).fill('Zebra additional review'); await page.getByLabel('Allowed website origins',{exact: true}).fill('http://localhost:4321'); await page.getByRole('button',{name: 'Create project',exact: true}).click();
 await page.getByRole('combobox',{name: 'Project',exact: true}).selectOption({label: 'Zebra additional review'}); await expect(page.getByText('Allowed origins: http://localhost:4321',{exact: false})).toBeVisible(); await expect(page.locator('pre').first()).toContainText('data-project=');
});
test('script installation carries its CSP nonce into isolated widget styles',async ({page}) => {
 await page.route(server + '/csp-fixture',async route => {await route.fulfill({status: 200,contentType: 'text/html',headers: {'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'nonce-huddle-fixture'; connect-src 'self'; object-src 'none'"},body: '<!doctype html><html lang="en"><head><title>CSP fixture</title></head><body><main><h1>Review with an isolated stylesheet</h1></main></body></html>'});});
 await page.goto(server + '/csp-fixture');
 await page.evaluate(async () => {await new Promise<void>((resolve,reject) => {const script = document.createElement('script'); script.src = 'http://127.0.0.1:4311/embed.js'; script.nonce = 'huddle-fixture'; script.dataset.project = '11111111-1111-4111-8111-111111111111'; script.dataset.environment = 'staging'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Installer failed')); document.head.append(script);});});
 await expect(page.getByRole('button',{name: 'Open Huddle',exact: true})).toBeVisible();
 expect(await page.locator('[data-huddle-root]').evaluate(el => ({nonce: el.shadowRoot!.querySelector('style')!.nonce,color: getComputedStyle(el.shadowRoot!.querySelector('.launcher')!).backgroundColor}))).toEqual({nonce: 'huddle-fixture',color: 'rgb(23, 95, 76)'});
 await page.getByRole('button',{name: 'Open Huddle',exact: true}).click(); await expect(page.getByRole('button',{name: 'Connect Huddle',exact: true})).toBeVisible();
});
