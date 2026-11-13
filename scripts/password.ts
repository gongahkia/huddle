import {createInterface} from 'node:readline/promises';
import {Writable, type Readable} from 'node:stream';

export async function bootstrapPassword({password = process.env.HUDDLE_BOOTSTRAP_PASSWORD, input = process.stdin, output = process.stdout}: {
  password?: string; input?: Readable & {isTTY?: boolean}; output?: Writable & {isTTY?: boolean};
} = {}): Promise<string> {
  if (password !== undefined) {
    if (password.length < 12) throw new Error('Choose a password of at least 12 characters.');
    return password;
  }
  if (!input.isTTY || !output.isTTY) throw new Error('Run bootstrap in a terminal for a hidden password prompt, or set HUDDLE_BOOTSTRAP_PASSWORD (12+ characters) for automation.');
  // readline puts terminal input in raw mode; discard its output so neither the
  // password nor terminal redraw sequences are echoed or retained in history.
  const muted = new Writable({write(_chunk, _encoding, callback) {callback();}});
  const readline = createInterface({input,output: muted,terminal: true,historySize: 0});
  const controller = new AbortController();
  readline.on('SIGINT',() => controller.abort());
  readline.on('close',() => controller.abort());
  try {
    output.write('Choose an administrator password (12+ characters): ');
    const first = await readline.question('',{signal: controller.signal});
    if (first.length < 12) throw new Error('Choose a password of at least 12 characters.');
    output.write('\nConfirm password: ');
    const confirmation = await readline.question('',{signal: controller.signal});
    if (confirmation !== first) throw new Error('Passwords did not match. Run bootstrap again.');
    return first;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Password entry cancelled.',{cause: error});
    throw error;
  } finally {
    output.write('\n');
    readline.close();
    muted.end();
  }
}
