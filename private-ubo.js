'use strict';
// Electron cannot load extensions into an in-memory session. Private requests
// use the already loaded uBO engines, without registering private tabs, loggers,
// cookies or page stores in the persistent extension session. No second engine.
const install = `(async()=>{
 const [{default:engine},{FilteringContext},rules]=await Promise.all([
  import('./js/static-net-filtering.js'),import('./js/filtering-context.js'),import('./js/filtering-engines.js')]);
 self.mondiumPrivateFilter=batch=>batch.map(d=>{
  if(!µBlock.readyToFilter)throw Error('uBO not ready');
  if(µBlock.getNetFilteringSwitch(d.document)===false)return false;
  const c=new FilteringContext().setType(d.type).setURL(d.url).setDocOriginFromURL(d.document).setTabOriginFromURL(d.top);
  let result=rules.sessionURLFiltering.evaluateZ(c.getTabHostname(),d.url,d.type);
  if(result===0&&µBlock.userSettings.advancedUserEnabled)result=rules.sessionFirewall.evaluateCellZY(c.getTabHostname(),c.getHostname(),d.type);
  if(result===0||result===3)result=engine.matchRequest(c);
  return result===1;
 });
})()`;
async function attachPrivateUBlock(ses, getBackground, webContents) {
 const bg=getBackground();if(!bg)throw Error('uBO background is unavailable');
 await bg.executeJavaScript(install);
 const types={mainFrame:'main_frame',subFrame:'sub_frame',xhr:'xmlhttprequest',webSocket:'websocket',cspReport:'csp_report'};
 let queue=[],scheduled=false;
 function flush(){
  const batch=queue.splice(0,64);if(!batch.length){scheduled=false;return;}
  const background=getBackground();
  const done=results=>{
   batch.forEach((r,i)=>{try{r.callback({cancel:results?.[i]!==false})}catch{}});
   if(queue.length)setImmediate(flush);else scheduled=false;
  };
  if(!background){done();}else{
   // Batch IPC to avoid one renderer evaluation per resource. The transient
   // request objects are not stored by uBO and never enter its request logger.
   const timer=setTimeout(()=>finish(),2000);let finished=false;
   const finish=results=>{if(finished)return;finished=true;clearTimeout(timer);done(results)};
   background.executeJavaScript(`self.mondiumPrivateFilter(${JSON.stringify(batch.map(r=>r.data))})`).then(finish,()=>finish());
  }
 }
 ses.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(details,callback)=>{
  if(queue.length>=2048){callback({cancel:true});return;}
  const wc=webContents.fromId(details.webContentsId);
  const top=details.resourceType==='mainFrame'?details.url:wc?.getURL()||details.referrer||details.url;
  const document=details.frame?.url||details.referrer||top;
  queue.push({callback,data:{url:details.url,type:types[details.resourceType]||details.resourceType||'other',document:details.resourceType==='mainFrame'?details.url:document,top}});
  if(!scheduled){scheduled=true;setImmediate(flush);}
 });
}
module.exports={attachPrivateUBlock};
