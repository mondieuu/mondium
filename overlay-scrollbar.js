'use strict';
// A thin overlay for the document and browser tab lists. Content keeps the full
// viewport width; only the transparent edge hit target receives pointer events.
const { webFrame } = require('electron');
if (window.top === window && /^(https?:|file:)$/.test(location.protocol)) {
  webFrame.insertCSS(':root::-webkit-scrollbar,body::-webkit-scrollbar,#vtabs::-webkit-scrollbar,#pinnedtabs::-webkit-scrollbar,[data-mondium-scrollable]::-webkit-scrollbar{width:0!important;height:0!important}:root,body,#vtabs,#pinnedtabs,[data-mondium-scrollable]{scrollbar-width:none!important}');
  const start = () => {
    const entries = new Map();
    let pending = false;
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(update); } };
    function add(target) {
      if (!target || entries.has(target)) return;
      const host = document.createElement('div');
      host.setAttribute('data-mondium-scrollbar',target===document.scrollingElement?'document':'panel');
      if(target!==document.scrollingElement)target.setAttribute('data-mondium-scrollable','');
      host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;right:0!important;top:0!important;width:10px!important;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':host{color-scheme:light dark}.track{position:absolute;inset:0;pointer-events:auto;touch-action:none}.thumb{position:absolute;right:1px;width:1px;border-radius:4px;background:#808080;opacity:.7;transition:width .12s,opacity .12s;pointer-events:none}.track:hover .thumb,.track.drag .thumb{width:4px;opacity:1}.track:focus-visible{outline:1px solid #808080;outline-offset:-1px}');
      shadow.adoptedStyleSheets = [sheet];
      const track = document.createElement('div'), thumb = document.createElement('div');
      track.className = 'track'; thumb.className = 'thumb'; track.append(thumb); shadow.append(track);
      track.tabIndex = 0; track.setAttribute('role', 'scrollbar');
      track.setAttribute('aria-label', location.protocol === 'file:' && document.documentElement.lang !== 'en' ? 'Kaydır' : 'Scroll');
      track.setAttribute('aria-orientation', 'vertical');track.setAttribute('aria-valuemin','0');
      const entry = { target, host, track, thumb, dragging: null, top: 0, height: 0, thumbHeight: 0, max: 0 };
      entries.set(target, entry); document.documentElement.append(host);
      const scrollTo = y => { target.scrollTop = Math.max(0, Math.min(entry.max, y)); schedule(); };
      track.addEventListener('pointerdown', e => {
        if(e.button!==0)return;
        e.preventDefault();track.setPointerCapture(e.pointerId);track.classList.add('drag');
        const offset=e.clientY-entry.top, current=entry.max?target.scrollTop/entry.max*(entry.height-entry.thumbHeight):0;
        if(offset<current || offset>current+entry.thumbHeight)scrollTo((offset-entry.thumbHeight/2)/(entry.height-entry.thumbHeight)*entry.max);
        entry.dragging={y:e.clientY,scroll:target.scrollTop};
      });
      track.addEventListener('pointermove', e => {if(entry.dragging)scrollTo(entry.dragging.scroll+(e.clientY-entry.dragging.y)/Math.max(1,entry.height-entry.thumbHeight)*entry.max);});
      const stop=()=>{entry.dragging=null;track.classList.remove('drag');};
      track.addEventListener('pointerup',stop);track.addEventListener('lostpointercapture',stop);
      track.addEventListener('keydown',e=>{const delta={ArrowDown:40,ArrowUp:-40,PageDown:entry.height,PageUp:-entry.height};if(e.key==='Home'||e.key==='End'||e.key in delta){e.preventDefault();scrollTo(e.key==='Home'?0:e.key==='End'?entry.max:target.scrollTop+delta[e.key]);}});
      track.addEventListener('wheel',e=>{e.preventDefault();scrollTo(target.scrollTop+e.deltaY*(e.deltaMode===1?20:e.deltaMode===2?entry.height:1));},{passive:false});
      target.addEventListener('scroll',schedule,{passive:true});
      observer.observe(target);
    }
    const observer = new ResizeObserver(schedule);
    function update() {
      pending = false;
      add(document.scrollingElement);
      if(location.protocol==='file:' && /\/ui\.html$/.test(location.pathname))for(const id of ['vtabs','pinnedtabs'])add(document.getElementById(id));
      const dialogs=location.protocol==='file:'?[...document.querySelectorAll('.modal .dlg')]:[];
      for(const dialog of dialogs)add(dialog);
      const activeDialog=dialogs.find(d=>d.getClientRects().length&&getComputedStyle(d).visibility!=='hidden');
      for (const [target, e] of entries) {
        if(!target.isConnected){e.host.remove();observer.unobserve(target);entries.delete(target);continue;}
        const root=target===document.scrollingElement,r=root?{top:0,right:innerWidth,bottom:innerHeight,height:innerHeight}:target.getBoundingClientRect();
        const height=root?innerHeight:target.clientHeight,max=target.scrollHeight-height;
        e.host.style.setProperty('display',max>1&&r.right>0&&r.bottom>0&&height>0&&(!activeDialog||activeDialog===target)?'block':'none','important');
        if(max<=1)continue;
        const top=Math.max(0,r.top),visibleHeight=Math.min(height,innerHeight-top);
        e.top=top;e.height=visibleHeight;e.max=max;e.thumbHeight=Math.min(visibleHeight,Math.max(24,visibleHeight*height/target.scrollHeight));
        e.host.style.setProperty('top',top+'px','important');e.host.style.setProperty('right',Math.max(0,innerWidth-r.right)+'px','important');e.host.style.setProperty('height',visibleHeight+'px','important');
        e.thumb.style.height=e.thumbHeight+'px';e.thumb.style.top=Math.max(0,target.scrollTop)/max*(visibleHeight-e.thumbHeight)+'px';
        e.track.setAttribute('aria-valuemax',String(Math.round(max)));e.track.setAttribute('aria-valuenow',String(Math.round(target.scrollTop)));
      }
    }
    // Web pages often animate classes/styles continuously. Size and scroll events
    // are enough there; observe DOM mutations only for our own dynamic dialogs.
    if(location.protocol==='file:')new MutationObserver(records=>{if(records.some(r=>!r.target.hasAttribute?.('data-mondium-scrollbar')))schedule();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style']});
    window.addEventListener('load',schedule,true);
    observer.observe(document.documentElement);if(document.body)observer.observe(document.body);
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);document.addEventListener('transitionend',schedule,true);
    update();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
