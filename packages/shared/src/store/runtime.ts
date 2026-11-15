export type Runtime = {
 uuid():string; randomInt(max:number):number;
 hash():{update(value:string|Uint8Array):unknown;digest(encoding:'hex'):string};
 hmac(secret:string,value:string):Uint8Array;
 equal(a:Uint8Array,b:Uint8Array):boolean;
};
export function encodeBytes(bytes:Uint8Array):string {let text='';for(let index=0;index<bytes.length;index+=8192)text+=String.fromCharCode(...bytes.subarray(index,index+8192));return btoa(text);}
export function decodeBytes(value:string):Uint8Array {return Uint8Array.from(atob(value),letter=>letter.charCodeAt(0));}
export const encodeText=(text:string)=>encodeBytes(new TextEncoder().encode(text)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const decodeText=(value:string)=>new TextDecoder('utf-8',{fatal:true}).decode(decodeBytes(value.replaceAll('-','+').replaceAll('_','/')));
export function concatBytes(chunks:Uint8Array[]):Uint8Array {const bytes=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0));let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;}
