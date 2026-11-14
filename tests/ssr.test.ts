import {expect, it} from 'vitest';
import {TestAdapter} from './fixtures/adapter';
import {mount} from '../packages/browser/src/index';
it('imports without browser globals and explains the client lifecycle requirement',() => {
 expect(() => mount({adapter: new TestAdapter(),namespace: 'ssr',workspace: 'team',environment: 'staging'})).toThrow('after hydration');
});
