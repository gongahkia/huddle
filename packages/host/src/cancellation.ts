export async function abortable<T>(run: () => Promise<T>,signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let abort: () => void = () => {};
  try {return await Promise.race([Promise.resolve().then(() => {signal.throwIfAborted(); return run();}),new Promise<never>((_,reject) => {abort = () => reject(signal.reason); signal.addEventListener('abort',abort,{once:true}); if (signal.aborted) abort();})]);}
  finally {signal.removeEventListener('abort',abort);}
}
