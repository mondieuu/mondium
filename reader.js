// Mondium okuma modu. Ana surec bunu sayfaya ayrik dunyada (isolated world) enjekte eder.
// Sayfanin ana yazisini bulur, sade bir katmanda gosterir. Tekrar calistirilinca katmani kapatir.
// innerHTML kullanilmaz (Trusted Types olan sitelerde de calissin); dugumler klonlanir ve temizlenir.
(() => {
  const ID = '__mondium_okuma';
  const old = document.getElementById(ID);
  if (old) { old.__close ? old.__close() : old.remove(); return 'kapandi'; }

  // ---- 1) Ana yaziyi bul: en cok paragraf metnini toplayan kapsayici
  const scores = new Map();
  for (const p of document.querySelectorAll('p, pre, blockquote')) {
    const len = (p.textContent || '').trim().length;
    if (len < 40) continue;
    let el = p.parentElement;
    for (let d = 0; el && d < 3; d++, el = el.parentElement) scores.set(el, (scores.get(el) || 0) + len / (d + 1));
  }
  let best = null, bestScore = 0;
  for (const [el, sc] of scores) if (sc > bestScore) { best = el; bestScore = sc; }
  const art = document.querySelector('article');
  if (art && (art.textContent || '').trim().length > 400 && (!best || art.contains(best))) best = art;
  if (!best || bestScore < 250) return 'bulunamadi';

  // ---- 2) Temiz kopya
  const KEEP = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'IMG', 'PICTURE', 'SOURCE',
    'FIGURE', 'FIGCAPTION', 'A', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUP', 'SUB', 'SPAN', 'DIV', 'SECTION', 'ARTICLE', 'MARK', 'SMALL', 'DL', 'DT', 'DD']);
  const DROP = 'script, style, noscript, iframe, form, nav, aside, footer, button, input, select, textarea, svg, canvas, video, audio, object, embed, dialog, ' +
    '[role=navigation], [role=banner], [role=complementary], [role=dialog], [aria-hidden=true], [hidden]';
  const BAD_CLASS = /(^|[\s_-])(ad|ads|advert|banner|share|social|comment|comments|related|newsletter|promo|sponsor|subscribe|cookie|popup|modal|sidebar|footer|breadcrumb)([\s_-]|$)/i;
  const clean = (src) => {
    const root = src.cloneNode(true);
    root.querySelectorAll(DROP).forEach((n) => n.remove());
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (el !== root && (BAD_CLASS.test(el.className && el.className.baseVal === undefined ? el.className : '') || BAD_CLASS.test(el.id || ''))) {
        if ((el.textContent || '').length < 600) { el.remove(); continue; }
      }
      if (!KEEP.has(el.tagName)) {   // bilinmeyen ogeyi icerigiyle birlikte basit kapsayiciya cevir
        const span = document.createElement('div');
        while (el.firstChild) span.appendChild(el.firstChild);
        if (el.parentNode) el.parentNode.replaceChild(span, el);
        continue;
      }
      // Tembel yuklenen resimler
      if (el.tagName === 'IMG') {
        const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original');
        const src = el.currentSrc || el.src || lazy;
        if (lazy && !el.src) el.setAttribute('src', lazy);
        if (src) el.setAttribute('src', new URL(src, location.href).href);
        el.removeAttribute('srcset'); el.removeAttribute('sizes');
        el.loading = 'lazy';
      }
      if (el.tagName === 'A' && el.getAttribute('href')) { try { el.setAttribute('href', new URL(el.getAttribute('href'), location.href).href); } catch {} }
      for (const at of [...el.attributes]) {
        if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(at.name)) el.removeAttribute(at.name);
      }
    }
    // Bos kalan kapsayicilari at
    for (const el of [...root.querySelectorAll('div, span, section')].reverse()) {
      if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
    }
    return root;
  };
  const body = clean(best);

  const h1 = best.querySelector('h1') || document.querySelector('h1');
  const titleText = ((h1 && h1.textContent) || document.title || '').trim();
  if (h1 && best.contains(h1)) { const dup = body.querySelector('h1'); if (dup && dup.textContent.trim() === titleText) dup.remove(); }
  const words = (body.textContent || '').trim().split(/\s+/).length;

  // ---- 3) Katman
  const host = document.createElement('div');
  host.id = ID;
  host.style.setProperty('all', 'initial');
  host.style.setProperty('position', 'fixed');
  host.style.setProperty('inset', '0');
  host.style.setProperty('z-index', '2147483647');
  const shadow = host.attachShadow({ mode: 'closed' });
  const css = new CSSStyleSheet();
  css.replaceSync(`
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; overflow-y: auto; background: #f8f7f4; color: #1f1f1f; font: 19px/1.7 Georgia, "Times New Roman", serif; }
    .wrap.dark { background: #1e1e20; color: #e3e3e3; }
    .bar { position: sticky; top: 0; display: flex; justify-content: flex-end; gap: 6px; padding: 10px 16px; background: inherit; z-index: 1;
      font: 13px "Segoe UI", system-ui, sans-serif; }
    .bar button { height: 32px; min-width: 36px; padding: 0 12px; border-radius: 16px; border: 1px solid rgba(127,127,127,.35); background: none; color: inherit; font: inherit; cursor: default; }
    .bar button:hover { background: rgba(127,127,127,.15); }
    main { max-width: 680px; margin: 0 auto; padding: 8px 24px 96px; }
    .meta { font: 13px "Segoe UI", system-ui, sans-serif; opacity: .65; margin-bottom: 6px; }
    h1.t { font-size: 1.9em; line-height: 1.25; margin: 0 0 24px; }
    img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 16px auto; }
    a { color: #0b57d0; } .dark a { color: #a8c7fa; }
    pre, code { font-family: Consolas, monospace; font-size: .85em; background: rgba(127,127,127,.12); border-radius: 4px; }
    pre { padding: 12px; overflow-x: auto; white-space: pre-wrap; }
    blockquote { margin: 16px 0; padding-left: 16px; border-left: 3px solid rgba(127,127,127,.5); opacity: .9; }
    table { border-collapse: collapse; max-width: 100%; font-size: .85em; } td, th { border: 1px solid rgba(127,127,127,.3); padding: 4px 8px; }
    figcaption { font-size: .8em; opacity: .7; text-align: center; }
    h2, h3, h4 { line-height: 1.3; margin: 1.4em 0 .5em; }
  `);
  shadow.adoptedStyleSheets = [css];
  const wrap = document.createElement('div');
  wrap.className = 'wrap' + (matchMedia('(prefers-color-scheme: dark)').matches ? ' dark' : '');
  const bar = document.createElement('div'); bar.className = 'bar';
  const btn = (label, title, fn) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.onclick = fn; bar.appendChild(b); };
  let size = 19;
  btn('A−', 'Yazıyı küçült', () => { size = Math.max(14, size - 1); wrap.style.fontSize = size + 'px'; });
  btn('A+', 'Yazıyı büyüt', () => { size = Math.min(30, size + 1); wrap.style.fontSize = size + 'px'; });
  btn('◐', 'Açık / koyu', () => wrap.classList.toggle('dark'));
  btn('Kapat', 'Okuma modunu kapat (Esc veya F9)', () => close());
  const main = document.createElement('main');
  const meta = document.createElement('div'); meta.className = 'meta';
  meta.textContent = location.hostname.replace(/^www\./, '') + ' · yaklaşık ' + Math.max(1, Math.round(words / 200)) + ' dk okuma';
  const t = document.createElement('h1'); t.className = 't'; t.textContent = titleText;
  main.append(meta, t, body);
  wrap.append(bar, main);
  shadow.appendChild(wrap);

  const prevOverflow = document.documentElement.style.overflow;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.style.overflow = prevOverflow;
    host.remove();
  }
  host.__close = close;
  document.addEventListener('keydown', onKey, true);
  document.documentElement.style.overflow = 'hidden';
  (document.body || document.documentElement).appendChild(host);
  wrap.focus();
  return 'acik';
})();
