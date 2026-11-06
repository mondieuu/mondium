'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const MAX_CRX=64*1024*1024, MAX_FILE=32*1024*1024, MAX_TOTAL=256*1024*1024;
const idOf=key=>crypto.createHash('sha256').update(key).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
function fields(buffer) {
 let offset=0;const out=new Map();
 const integer=()=>{let n=0,scale=1;for(let i=0;i<8;i++){if(offset>=buffer.length)throw Error('Truncated protobuf');const b=buffer[offset++];n+=(b&127)*scale;if(!Number.isSafeInteger(n))throw Error('Invalid protobuf');if(!(b&128))return n;scale*=128;}throw Error('Invalid protobuf');};
 while(offset<buffer.length){const tag=integer(),wire=tag&7,key=Math.floor(tag/8);if(!key)throw Error('Invalid protobuf tag');if(wire===2){const length=integer();if(length>buffer.length-offset)throw Error('Truncated protobuf field');if(!out.has(key))out.set(key,[]);out.get(key).push(buffer.subarray(offset,offset+length));offset+=length;}else if(wire===0)integer();else if(wire===1)offset+=8;else if(wire===5)offset+=4;else throw Error('Unsupported protobuf field');if(offset>buffer.length)throw Error('Truncated protobuf');}
 return out;
}
function parseCrx(buffer) {
 if(!Buffer.isBuffer(buffer)||buffer.length<16||buffer.length>MAX_CRX||buffer.toString('ascii',0,4)!=='Cr24')throw Error('Invalid or oversized CRX');
 const version=buffer.readUInt32LE(4);let publicKey,contents,header,signature,extensionId;
 if(version===2)throw Error('Legacy CRX2 packages are not accepted');
 if(version===3){const size=buffer.readUInt32LE(8);if(!size||size>1024*1024||size+12>=buffer.length)throw Error('Invalid CRX3 header');header=buffer.subarray(12,12+size);contents=buffer.subarray(12+size);const f=fields(header),signed=f.get(10000);if(signed?.length!==1)throw Error('Missing CRX signed header');const id=fields(signed[0]).get(1);if(id?.length!==1||id[0].length!==16)throw Error('Invalid CRX ID');extensionId=id[0].toString('hex').replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));const len=Buffer.alloc(4);len.writeUInt32LE(signed[0].length);const data=Buffer.concat([Buffer.from('CRX3 SignedData\0','binary'),len,signed[0],contents]);
  for(const proof of [...(f.get(2)||[]),...(f.get(3)||[])]){const p=fields(proof),key=p.get(1)?.[0],sig=p.get(2)?.[0];if(!key||!sig||idOf(key)!==extensionId)continue;try{if(crypto.verify('sha256',data,{key,format:'der',type:'spki'},sig)){publicKey=key;break;}}catch{}}
  if(!publicKey)throw Error('Invalid CRX3 content signature');
 }else throw Error('Unsupported CRX version');
 return {extensionId,version,header,contents,publicKey};
}
function extractZip(buffer,destination) {
 if(buffer.length>MAX_CRX)throw Error('Archive too large');
 // Validate entry count before adm-zip constructs entry objects (also bounds header-only bombs).
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw Error('Unsupported archive directory');
 const count=buffer.readUInt16LE(end+10),directorySize=buffer.readUInt32LE(end+12),directoryStart=buffer.readUInt32LE(end+16);
 if(count>20000||directorySize>8*1024*1024||directoryStart+directorySize>end)throw Error('Archive directory exceeds limits');
 let cursor=directoryStart,actual=0;while(cursor<directoryStart+directorySize){if(cursor+46>directoryStart+directorySize||buffer.readUInt32LE(cursor)!==0x02014b50)throw Error('Invalid archive directory');cursor+=46+buffer.readUInt16LE(cursor+28)+buffer.readUInt16LE(cursor+30)+buffer.readUInt16LE(cursor+32);if(++actual>20000)throw Error('Too many archive entries');}
 if(cursor!==directoryStart+directorySize||actual!==count)throw Error('Invalid archive entry count');
 const AdmZip=require('adm-zip'),zip=new AdmZip(buffer,{maxOutputLength:MAX_FILE}),entries=zip.getEntries(),seen=new Set();if(entries.length>20000)throw Error('Too many archive entries');
 const root=path.resolve(destination);let total=0;const files=[];
 for(const e of entries){const name=e.entryName;if(!name||name.includes('\\')||name.includes('\0')||path.posix.isAbsolute(name))throw Error('Unsafe archive path');const parts=name.replace(/\/$/,'').split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))throw Error('Unsafe archive name');const key=parts.join('/').normalize('NFC').toLowerCase();if(seen.has(key))throw Error('Duplicate archive path');seen.add(key);const mode=(e.header.attr>>>16)&0xf000;if(mode===0xa000)throw Error('Archive symlink rejected');const size=e.header.size;total+=size;if(!Number.isSafeInteger(size)||size<0||size>MAX_FILE||total>MAX_TOTAL)throw Error('Archive exceeds extraction limits');const target=path.resolve(root,...parts);if(!target.startsWith(root+path.sep))throw Error('Archive path escape');files.push({e,target,size});}
 fs.mkdirSync(root,{recursive:true});if(fs.lstatSync(root).isSymbolicLink())throw Error('Unsafe destination');
 for(const {e,target,size}of files){let parent=root;const dirs=path.relative(root,e.isDirectory?target:path.dirname(target)).split(path.sep).filter(Boolean);for(const d of dirs){parent=path.join(parent,d);if(fs.existsSync(parent)){if(!fs.lstatSync(parent).isDirectory()||fs.lstatSync(parent).isSymbolicLink())throw Error('Unsafe destination directory');}else fs.mkdirSync(parent,{mode:0o755});}if(!e.isDirectory){const data=e.getData();if(data.length!==size||data.length>MAX_FILE)throw Error('Archive size mismatch');fs.writeFileSync(target,data,{flag:'wx',mode:0o644});}}
}
module.exports={parseCrx,extractZip,idOf,MAX_CRX};
