import {CollaborationError,isByteChunk} from '../../shared/src/collaboration';
// Coalesce arbitrary network/source fragmentation into bounded 64 KiB parts.
export class ByteCollector {
  private parts:Uint8Array<ArrayBuffer>[] = []; private block = new Uint8Array(65536); private used = 0; private size = 0;
  constructor(private limit:number,private kind:'upload'|'download') {}
  add(value:unknown) {
    if(!isByteChunk(value)) throw new CollaborationError(this.kind === 'upload' ? 'validation' : 'unavailable',`The ${this.kind} contains invalid byte data.`);
    if(this.size+value.byteLength > this.limit) throw new CollaborationError('validation',`The ${this.kind} exceeds its ${this.limit} byte browser limit. Choose a smaller export scope/file or contact the application team.`);
    this.size += value.byteLength;
    for(let offset=0;offset<value.length;) {const length = Math.min(this.block.length-this.used,value.length-offset); this.block.set(value.subarray(offset,offset+length),this.used); this.used += length; offset += length; if(this.used === this.block.length) {this.parts.push(this.block); this.block = new Uint8Array(65536); this.used = 0;}}
  }
  blob(type:string) {return new Blob([...this.parts,...(this.used ? [this.block.slice(0,this.used)] : [])],{type});}
}
