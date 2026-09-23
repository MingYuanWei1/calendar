import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

// fontkit re-inflates a compressed WOFF table on every glyph access. Keep the
// bundled font as WOFF, but expand its tables once for the server's PDF renderer.
export function uncompressedWoff(path){
 const source=Buffer.isBuffer(path)?path:readFileSync(path);
 if(source.toString('ascii',0,4)!=='wOFF')throw new Error('Expected bundled WOFF font');
 const count=source.readUInt16BE(12),tables=[];
 let length=44+20*count;
 for(let i=0;i<count;i++){
  const entry=44+i*20,offset=source.readUInt32BE(entry+4),compressed=source.readUInt32BE(entry+8),original=source.readUInt32BE(entry+12);
  const data=source.subarray(offset,offset+compressed),expanded=compressed<original?inflateSync(data):data;
  if(expanded.length!==original)throw new Error('Invalid bundled font table');
  tables.push({entry,offset:length,data:expanded});length+=Math.ceil(original/4)*4;
 }
 const output=Buffer.alloc(length);source.copy(output,0,0,44+20*count);
 output.writeUInt32BE(length,8);output.fill(0,24,44); // metadata/private blocks are not needed
 for(const {entry,offset,data} of tables){output.writeUInt32BE(offset,entry+4);output.writeUInt32BE(data.length,entry+8);data.copy(output,offset);}
 return output;
}
