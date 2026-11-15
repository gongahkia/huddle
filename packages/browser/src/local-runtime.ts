import {sha256} from '@noble/hashes/sha2.js';
import {hmac} from '@noble/hashes/hmac.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {Runtime} from '../../shared/src/store/runtime';
const utf8=new TextEncoder();
export const browserRuntime:Runtime={
 uuid:()=>crypto.randomUUID(),
 randomInt(max){const ceiling=Math.floor(0x100000000/max)*max,value=new Uint32Array(1);do{crypto.getRandomValues(value);}while(value[0]>=ceiling);return value[0]%max;},
 hash(){const hash=sha256.create();return {update(value){hash.update(typeof value==='string'?utf8.encode(value):value);},digest(){return bytesToHex(hash.digest());}};},
 hmac:(secret,value)=>hmac(sha256,utf8.encode(secret),utf8.encode(value)),
 equal(a,b){if(a.length!==b.length)return false;let difference=0;for(let index=0;index<a.length;index++)difference|=a[index]^b[index];return difference===0;},
};
