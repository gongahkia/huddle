import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import {ByteCollector} from '../packages/browser/src/bytes';
it('preserves UTF-8 across arbitrary fragments and accepts byte views from another realm',async () => {
  const data = new TextEncoder().encode('汉字😀'.repeat(18000)), collector = new ByteCollector(data.length,'upload'); for(let offset=0;offset<data.length;offset+=73) collector.add(data.subarray(offset,offset+73)); expect(await collector.blob('application/json').text()).toBe('汉字😀'.repeat(18000));
  const foreign = new ByteCollector(2,'download'); foreign.add(runInNewContext('Uint8Array.of(123,125)')); expect(await foreign.blob('application/json').text()).toBe('{}');
});
it('rejects invalid and oversized chunks before accepting their bytes',async () => {
  const collector = new ByteCollector(2,'upload'); collector.add(new Uint8Array([123,125])); expect(() => collector.add(new Uint8Array([1]))).toThrow(expect.objectContaining({code:'validation'})); expect(await collector.blob('application/json').text()).toBe('{}'); expect(() => new ByteCollector(10,'download').add(new DataView(new ArrayBuffer(1)))).toThrow(expect.objectContaining({code:'unavailable'}));
});
