import {afterEach, expect, it, vi} from 'vitest';
import {PassThrough} from 'node:stream';
import {bootstrapPassword} from '../scripts/password';

afterEach(() => vi.unstubAllEnvs());
function terminal(first: string, confirmation?: string) {
  vi.stubEnv('HUDDLE_BOOTSTRAP_PASSWORD',undefined);
  const raw: boolean[] = [];
  const input = Object.assign(new PassThrough(),{isTTY: true,isRaw: false,setRawMode(value: boolean) {raw.push(value); this.isRaw = value; return this;}});
  const output = Object.assign(new PassThrough(),{isTTY: true});
  let displayed = '';
  output.on('data',(chunk: Buffer) => {
    displayed += chunk.toString();
    if (chunk.toString().includes('Confirm password: ')) queueMicrotask(() => input.write(`${confirmation}\r`));
  });
  const password = bootstrapPassword({input,output});
  queueMicrotask(() => input.write(first));
  return {password,raw,displayed: () => displayed};
}
it('prompts twice without echoing the password and restores terminal mode',async () => {
  const t = terminal('fixture-password-long\r','fixture-password-long');
  await expect(t.password).resolves.toBe('fixture-password-long');
  expect(t.displayed()).toBe('Choose an administrator password (12+ characters): \nConfirm password: \n');
  expect(t.raw).toEqual([true,false]);
});
it('rejects mismatches and short passwords without exposing either input',async () => {
  const mismatch = terminal('fixture-password-long\r','different-password-long');
  await expect(mismatch.password).rejects.toThrow('Passwords did not match');
  expect(mismatch.displayed()).not.toContain('fixture-password-long');
  expect(mismatch.displayed()).not.toContain('different-password-long');
  const short = terminal('short\r');
  await expect(short.password).rejects.toThrow('at least 12');
  expect(short.raw.at(-1)).toBe(false);
});
it.each(['\u0003','\u0004'])('cancels safely on terminal interrupt or EOF (%j)',async key => {
  const t = terminal(key);
  await expect(t.password).rejects.toThrow('Password entry cancelled');
  expect(t.raw.at(-1)).toBe(false);
});
it('keeps automation noninteractive and rejects missing or short credentials',async () => {
  vi.stubEnv('HUDDLE_BOOTSTRAP_PASSWORD',undefined);
  await expect(bootstrapPassword({password: 'automation-password-long'})).resolves.toBe('automation-password-long');
  await expect(bootstrapPassword({password: 'short'})).rejects.toThrow('at least 12');
  await expect(bootstrapPassword({input: new PassThrough(),output: new PassThrough()})).rejects.toThrow('HUDDLE_BOOTSTRAP_PASSWORD');
});
