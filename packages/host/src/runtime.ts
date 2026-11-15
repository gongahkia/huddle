import {createHash,createHmac,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Runtime} from '../../shared/src/store/runtime';
export const nodeRuntime:Runtime={uuid:randomUUID,randomInt,hash:()=>createHash('sha256'),hmac:(secret,value)=>createHmac('sha256',secret).update(value).digest(),equal:(a,b)=>a.length===b.length&&timingSafeEqual(a,b)};
