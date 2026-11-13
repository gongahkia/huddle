import {expect, it} from 'vitest';
import {mount} from '../packages/browser/src/index';
it('imports without browser globals and explains the client lifecycle requirement',() => {
 expect(() => mount({serverUrl: 'https://huddle.test',projectId: 'project',environment: 'staging'})).toThrow('after hydration');
});
