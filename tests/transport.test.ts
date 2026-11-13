// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Api, ChangeStream} from '../packages/browser/src/transport';
import type {Change} from '@huddle/shared';
beforeEach(() => {vi.useFakeTimers(); vi.spyOn(document,'visibilityState','get').mockReturnValue('visible'); vi.spyOn(Math,'random').mockReturnValue(0);});
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
function pending(signal: AbortSignal) {return new Promise<Response>((_resolve,reject) => {if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort',() => reject(signal.reason),{once: true});});}
const tick = () => vi.advanceTimersByTimeAsync(0);
it('bounds a hung request and its response body, without retrying writes',async () => {
  const fetcher = vi.fn((_url: string, init: RequestInit) => pending(init.signal!)); vi.stubGlobal('fetch',fetcher);
  const api = new Api('https://huddle.test','project',100);
  const write = expect(api.request('/threads','POST',{body: 'note'})).rejects.toMatchObject({status: 408});
  await vi.advanceTimersByTimeAsync(100); await write; expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  fetcher.mockImplementation((_url,init) => Promise.resolve(new Response(new ReadableStream({start(controller) {init.signal!.addEventListener('abort',() => controller.error(init.signal!.reason),{once: true});}}))));
  const body = expect(api.request('/threads')).rejects.toMatchObject({status: 408});
  await vi.advanceTimersByTimeAsync(100); await body; expect(vi.getTimerCount()).toBe(0);
});
it('reports proxy/non-JSON errors and cancels work during teardown',async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('<h1>Unavailable</h1>',{status: 503})).mockResolvedValueOnce(new Response('not JSON'));
  vi.stubGlobal('fetch',fetcher); const api = new Api('https://huddle.test','project');
  await expect(api.request('/threads')).rejects.toMatchObject({status: 503,message: expect.stringContaining('unreadable')});
  await expect(api.request('/threads')).rejects.toMatchObject({status: 502});
  fetcher.mockImplementation((_url: string,init: RequestInit) => pending(init.signal!));
  const request = expect(api.request('/threads')).rejects.toMatchObject({name: 'AbortError'}); api.destroy(); await request;
  expect(vi.getTimerCount()).toBe(0);
});
it('recovers a silent stream with bounded jitter and cancels reconnect on destroy',async () => {
  const fetcher = vi.fn((_url: string,init: RequestInit) => pending(init.signal!)); vi.stubGlobal('fetch',fetcher);
  const error = vi.fn(), stream = new ChangeStream(new Api('https://huddle.test','project'),0,vi.fn(),error);
  stream.start(); await vi.advanceTimersByTimeAsync(45000);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('Reconnecting'),false);
  await vi.advanceTimersByTimeAsync(375); expect(fetcher).toHaveBeenCalledTimes(2);
  stream.stop(); await tick(); expect(vi.getTimerCount()).toBe(0);
});
it('processes a large catch-up batch without treating the batch as an oversized event',async () => {
  const events = Array.from({length: 1000},(_,i) => ({seq: i + 1,threadId: `thread-${i}`,environment: 'staging',type: 'created'}));
  const data = events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''); expect(data.length).toBeGreaterThan(65536);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(data)));
  const received: Change[] = [], stream = new ChangeStream(new Api('https://huddle.test','project'),0,event => received.push(event),vi.fn());
  stream.start(); await tick(); expect(received).toEqual(events); stream.stop(); expect(vi.getTimerCount()).toBe(0);
});
it('resumes from the last processed event, ignores duplicates and stops on revoked access',async () => {
  const event = (seq: number) => `data: ${JSON.stringify({seq,threadId: 'thread',environment: 'staging',type: 'replied'})}\n\n`;
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(event(1) + event(2))).mockResolvedValueOnce(new Response(event(2) + event(3) + 'event: revoked\ndata: {}\n\n'));
  vi.stubGlobal('fetch',fetcher); const received: number[] = [], error = vi.fn();
  const stream = new ChangeStream(new Api('https://huddle.test','project'),0,event => received.push(event.seq),error);
  stream.start(); await tick(); await vi.advanceTimersByTimeAsync(375);
  expect(fetcher.mock.calls[1][0]).toContain('after=2'); expect(received).toEqual([1,2,3]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('revoked'),true); expect(vi.getTimerCount()).toBe(0);
});
it('pauses without reconnecting while the host document is hidden',async () => {
  const fetcher = vi.fn((_url: string,init: RequestInit) => pending(init.signal!)); vi.stubGlobal('fetch',fetcher);
  const stream = new ChangeStream(new Api('https://huddle.test','project'),0,vi.fn(),vi.fn());
  stream.start(); stream.pause(); await tick(); expect(vi.getTimerCount()).toBe(0);
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden'); stream.start(); expect(fetcher).toHaveBeenCalledTimes(1); stream.stop();
});
