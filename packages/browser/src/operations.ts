import {CollaborationError} from '../../shared/src/collaboration';

// Custom adapters may ignore cancellation. The engine must still release pending UI work.
export async function operation<T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs = 15000): Promise<T> {
  parent.throwIfAborted();
  const deadline = new AbortController(), signal = AbortSignal.any([parent,deadline.signal]);
  const timer = setTimeout(() => deadline.abort(),timeoutMs);
  let aborted: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve().then(() => {signal.throwIfAborted(); return run(signal);}),new Promise<never>((_,reject) => {
      aborted = () => reject(parent.aborted ? parent.reason : new CollaborationError('timeout','The host request timed out. Your draft is kept; retry explicitly.'));
      signal.addEventListener('abort',aborted,{once: true});
      if (signal.aborted) aborted();
    })]);
  } finally {clearTimeout(timer); signal.removeEventListener('abort',aborted);}
}
