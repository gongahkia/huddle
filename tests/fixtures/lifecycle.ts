export async function bounded<T>(promise: Promise<T>,ms: number,onTimeout: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise,new Promise<T>((resolve,reject) => {timer = setTimeout(() => {Promise.resolve().then(onTimeout).then(resolve,reject);},ms);})]);}
  finally {clearTimeout(timer);}
}
