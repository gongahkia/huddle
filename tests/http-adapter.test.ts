import {afterEach,expect,it,vi} from 'vitest';
import {createHttpAdapter} from '../packages/browser/src/http';
import {operation} from '../packages/browser/src/operations';
const scope = {workspace: 'host:team/1',environment: 'preview'}, signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
it('uses the same-origin host session, escaped IDs and the host CSRF hook without bearer credentials',async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}'));
  const adapter = createHttpAdapter({fetch,headers: () => ({'X-CSRF-Token': 'host-value'})});
  await adapter.reply(scope,'thread/one?x',{body: 'hello',idempotencyKey: 'request/1'},signal());
  const [path,init] = fetch.mock.calls[0]; expect(path).toBe('/api/huddle/v2/threads/thread%2Fone%3Fx/replies?workspace=host%3Ateam%2F1&environment=preview');
  expect(init?.credentials).toBe('same-origin'); const headers = new Headers(init?.headers); expect(headers.get('X-CSRF-Token')).toBe('host-value'); expect(headers.has('Authorization')).toBe(false);
  expect(JSON.parse(String(init?.body))).toEqual({body: 'hello',idempotencyKey: 'request/1'});
  expect(() => createHttpAdapter({basePath: 'https://old-service.test'})).toThrow('same-origin');
});
it('maps denial, conflict and rate limits without exposing raw proxy/internal error bodies',async () => {
  for (const [status,code] of [[401,'unauthenticated'],[403,'forbidden'],[409,'conflict'],[429,'rate_limited'],[500,'unavailable']] as const) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('<html>secret upstream details</html>',{status}));
    await expect(createHttpAdapter({fetch}).session(scope,signal())).rejects.toMatchObject({code,message: 'The host could not complete this review request.'}); expect(fetch).toHaveBeenCalledTimes(1);
  }
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({error: {code: 'rate_limited',message: 'Slow down.',retryAfterMs: 12000}}),{status: 429}));
  await expect(createHttpAdapter({fetch}).session(scope,signal())).rejects.toMatchObject({code: 'rate_limited',retryAfterMs: 12000});
});
it('deadlines cover a hung fetch and a hung JSON body even when the implementation ignores abort',async () => {
  vi.useFakeTimers();
  for (const result of [() => new Promise<Response>(() => {}),async () => new Response(new ReadableStream())]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(result), adapter = createHttpAdapter({fetch,timeoutMs: 100});
    const rejection = expect(adapter.session(scope,signal())).rejects.toMatchObject({code: 'timeout'}); await vi.advanceTimersByTimeAsync(101); await rejection; expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it('retains caller cancellation and cancels a host adapter that never settles',async () => {
  const controller = new AbortController();
  const rejected = expect(operation(() => new Promise(() => {}),controller.signal)).rejects.toMatchObject({name: 'AbortError'}); controller.abort(); await rejected;
});
it('streams export bytes and cancels the response when the consumer abandons it',async () => {
  let cancelled = false; const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('partial'));},cancel() {cancelled = true;}})));
  const file = await createHttpAdapter({fetch}).export({workspace: scope.workspace,environments: [scope.environment]},'json',signal());
  for await (const bytes of file.chunks) {expect(new TextDecoder().decode(bytes)).toBe('partial'); break;}
  expect(cancelled).toBe(true);
});
it('bounds staged imports before sending any upload and preserves exact JSON bytes',async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"uploadId":"upload/1","digest":"abc"}'));
  const chunks = async function*() {yield new TextEncoder().encode('{"历史":true}');};
  await expect(createHttpAdapter({fetch,maxUploadBytes: 2}).stageImport(scope,chunks(),signal())).rejects.toMatchObject({code: 'validation'}); expect(fetch).not.toHaveBeenCalled();
  await createHttpAdapter({fetch}).stageImport(scope,chunks(),signal());
  expect(await (fetch.mock.calls[0][1]!.body as Blob).text()).toBe('{"历史":true}');
});
