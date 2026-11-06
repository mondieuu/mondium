'use strict';
// Bound decompressed response bytes while reading, not after allocating the whole body.
async function readResponseBytes(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid response limit');
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Response too large'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) { const {done,value} = await reader.read(); if(done)break; total += value.byteLength; if(total>maxBytes)throw new Error('Response too large'); chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks,total);
  } finally { await reader.cancel().catch(()=>{}); }
}
function assertImageLimits(bytes) {
  const check=(w,h)=>{if(!Number.isFinite(w)||!Number.isFinite(h)||w<1||h<1||w>4096||h>4096||w*h>4*1024*1024)throw Error('Image dimensions exceed limits');};
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))check(bytes.readUInt32BE(16),bytes.readUInt32BE(20));
  else if(bytes.length>=10&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))check(bytes.readUInt16LE(6),bytes.readUInt16LE(8));
  else if(bytes.length>=26&&bytes.toString('ascii',0,2)==='BM')check(Math.abs(bytes.readInt32LE(18)),Math.abs(bytes.readInt32LE(22)));
  else if(bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    const type=bytes.toString('ascii',12,16);if(type==='VP8X')check(bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1);else if(type==='VP8L'){const bits=bytes.readUInt32LE(21);check((bits&16383)+1,((bits>>>14)&16383)+1);}else if(type==='VP8 ')check(bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383);
  } else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
    for(let i=2;i+4<=bytes.length;){if(bytes[i++]!==255)break;const marker=bytes[i++];if(marker===217||marker===218)break;if(marker===216||marker===1||marker>=208&&marker<=215)continue;const size=bytes.readUInt16BE(i);if(size<2||i+size>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=7){check(bytes.readUInt16BE(i+5),bytes.readUInt16BE(i+3));break;}i+=size;}
  }
}
module.exports = { readResponseBytes, assertImageLimits };
