import {expect,it} from 'vitest';
import * as z from 'zod/mini';
import {nodeRuntime} from '../packages/host/src/runtime';
import {browserRuntime} from '../packages/browser/src/local-runtime';
import {createValidation} from '../packages/shared/src/store/validation';
import {encodeBytes,decodeBytes,concatBytes} from '../packages/shared/src/store/runtime';

it.each([{name:'ASCII',value:'The quick brown fox jumps over the lazy dog'},{name:'Unicode',value:'中文 தமிழ் Melayu 👋\u0000'},{name:'fragmented input',value:'x'.repeat(65537)}])('keeps browser and server incremental SHA-256 and HMAC compatible for $name',({value})=>{
 const bytes=new TextEncoder().encode(value),native=nodeRuntime.hash(),browser=browserRuntime.hash();for(let offset=0;offset<bytes.length;offset+=17){native.update(bytes.subarray(offset,offset+17));browser.update(bytes.subarray(offset,offset+17));}expect(browser.digest('hex')).toBe(native.digest('hex'));expect([...browserRuntime.hmac('disposable-key',value)]).toEqual([...nodeRuntime.hmac('disposable-key',value)]);expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);expect(concatBytes([bytes.subarray(0,3),bytes.subarray(3)])).toEqual(bytes);
});
it('retains portable cursor binding and rejects a changed scope or authentication code',()=>{
 const server=createValidation(nodeRuntime),browser=createValidation(browserRuntime),binding={workspace:'团队',environment:'preview'},schema=z.strictObject({id:z.string()});const cursor=server.encodeCursor('disposable-cursor-key',binding,{id:'entry-1'});expect(browser.decodeCursor('disposable-cursor-key',binding,cursor,schema)).toEqual({id:'entry-1'});expect(browser.encodeCursor('disposable-cursor-key',binding,{id:'entry-1'})).toBe(cursor);expect(()=>browser.decodeCursor('wrong',binding,cursor,schema)).toThrow('Invalid or mismatched');expect(()=>server.decodeCursor('disposable-cursor-key',{...binding,environment:'other'},cursor,schema)).toThrow('Invalid or mismatched');
});
