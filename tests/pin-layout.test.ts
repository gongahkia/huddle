import {expect,it} from 'vitest';
import {placePin} from '../packages/browser/src/pin-layout';
it.each([{x:160,y:360},{x:0,y:0},{x:320,y:720}])('keeps 100 shared-anchor badges apart and inside a mobile viewport at $x/$y',point => {
  const placed:{x:number;y:number}[] = [], original = {...point};
  for(let index=0;index<100;index++) {
    const next = placePin(point,placed,{width:320,height:720}); expect(next.x).toBeGreaterThanOrEqual(16); expect(next.x).toBeLessThanOrEqual(304); expect(next.y).toBeGreaterThanOrEqual(16); expect(next.y).toBeLessThanOrEqual(704);
    for(const other of placed) expect(Math.hypot(next.x-other.x,next.y-other.y)).toBeGreaterThanOrEqual(34); placed.push(next);
  }
  expect(point).toEqual(original);
});
