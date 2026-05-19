import{a as U}from"./storage.js";const O="https://api.deepseek.com/v1/chat/completions",v="deepseek-chat",L=6e4;async function A({meta:e,html:n,css:t,js:r,apiKey:a}){var s,u,c;if(!a.trim())return null;const o=new AbortController,i=setTimeout(()=>o.abort(),L);try{const d=await fetch(O,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${a.trim()}`},body:JSON.stringify({model:v,temperature:.2,messages:[{role:"system",content:D},{role:"user",content:N(e,n,t,r)}]}),signal:o.signal});if(!d.ok)return null;const h=await d.json(),l=((c=(u=(s=h==null?void 0:h.choices)==null?void 0:s[0])==null?void 0:u.message)==null?void 0:c.content)??"",p=x(l);return!p||!/<html[\s>]/i.test(p)?null:p}catch{return null}finally{clearTimeout(i)}}const D=`You are a senior front-end engineer. Your job is to take three CodePen editor boxes (HTML, CSS, JS) and emit a single self-contained HTML document that renders the same result as the original Pen when opened directly from disk.

Rules:
- Output a complete <!doctype html> document. No prose, no markdown fences, no commentary.
- Inline the CSS in a <style> block in <head>.
- Inline the JS in a <script> block just before </body>. Use type="module" only if the JS uses ES module syntax.
- If the JS or HTML clearly depends on libraries (React, Vue, Three.js, GSAP, p5, jQuery, lodash, Babel, TypeScript, etc.), add the matching CDN <script> or <link> tags to <head>. Prefer unpkg or cdnjs. If JSX/TSX is present, include @babel/standalone and mark the user script with type="text/babel".
- If the HTML editor content is a fragment (no <html>/<body>), wrap it inside <body>. If it is a full document, keep its structure and inject styles/scripts into the right slots.
- Do not invent application logic that was not present in the source. Preserve identifiers, class names, and structure.
- Escape any literal "<\/script>" inside JS so it does not break parsing.
- Add <meta name="generator" content="CodePen Library Saver"> and <meta name="codepen:source" content="<canonical url>"> in <head>.

Return ONLY the HTML document.`;function N(e,n,t,r){return`Source URL: ${e.canonicalUrl}
Title: ${e.title}
Author: ${e.author||e.user}

=== HTML EDITOR ===
${n||"(empty)"}

=== CSS EDITOR ===
${t||"(empty)"}

=== JS EDITOR ===
${r||"(empty)"}

Produce one runnable standalone HTML file as described.`}function x(e){let n=e.trim();const t=n.match(/^```(?:html|HTML)?\s*([\s\S]*?)```$/);return t&&(n=t[1].trim()),n}const y=["html","css","js"];function C(e){const t=new URL(e).pathname.replace(/\/+$/,""),r=t.match(/^\/([^/]+)\/(?:pen|full|debug|details)\/([A-Za-z0-9_-]+)(?:\/.*)?$/);if(r){const[,o,i]=r;return{user:o,slug:i,canonicalUrl:`https://codepen.io/${o}/pen/${i}`}}const a=t.match(/^\/([^/]+)\/embed\/(?:preview|result|pen)?\/?([A-Za-z0-9_-]+)(?:\/.*)?$/);if(a){const[,o,i]=a;return{user:o,slug:i,canonicalUrl:`https://codepen.io/${o}/pen/${i}`}}return null}async function w(e,n={}){var d,h;const t=await j(e.canonicalUrl),r={...e,author:e.author||(t==null?void 0:t.author_name)||e.user,thumbnailUrl:e.thumbnailUrl||(t==null?void 0:t.thumbnail_url)||`https://codepen.io/${e.user}/pen/${e.slug}/image/small.png`,title:M(e.title||(t==null?void 0:t.title)||"Untitled Pen",t==null?void 0:t.author_name)},o=m((d=n.prefetched)==null?void 0:d.debugHtml)||await _(r);let i="debug-html",s=o?B(r,o):"";if(!s){const l=await H(r,n.prefetched),p=((h=n.deepseekApiKey)==null?void 0:h.trim())||"",S=l.hasAnyCode&&p?await A({meta:r,html:l.html,css:l.css,js:l.js,apiKey:p}):null;S?(i="ai-integrated",s=$(r,J(S))):(i=l.hasAnyCode?"separated-source":"page-html",s=R(r,l.html,l.css,l.js,!l.hasAnyCode))}const u=z(r),c=new Date().toISOString();return{...r,filename:u,html:s,id:`${r.user}/${r.slug}`,savedAt:c,sourceMode:i,tags:i==="separated-source"?["uncombined","needs-refactor"]:[]}}async function H(e,n){const t={html:m(n==null?void 0:n.html),css:m(n==null?void 0:n.css),js:m(n==null?void 0:n.js),hasAnyCode:!1};return t.hasAnyCode=y.some(r=>t[r].trim().length>0),t.hasAnyCode?t:I(e)}function m(e){return!e||f(e)?"":e}async function I(e){const n=await Promise.all(y.map(async r=>{const a=`${e.canonicalUrl}.${r}`;try{const o=await fetch(a,{credentials:"include"});if(!o.ok)return[r,""];const i=await o.text();return f(i)?[r,""]:[r,i]}catch{return[r,""]}})),t=Object.fromEntries(n);return{...t,hasAnyCode:y.some(r=>t[r].trim().length>0)}}async function _(e){const n=[`https://codepen.io/${e.user}/debug/${e.slug}`,`https://cdpn.io/${e.user}/debug/${e.slug}`];for(const t of n)try{const r=await fetch(t,{credentials:"include"});if(!r.ok)continue;const a=await r.text();if(a.trim()&&!f(a))return a}catch{continue}return null}async function j(e){try{const n=`https://codepen.io/api/oembed?format=json&url=${encodeURIComponent(e)}`,t=await fetch(n,{credentials:"include"});return t.ok?await t.json():null}catch{return null}}function R(e,n,t,r,a=!1){const o=X(r)?' type="module"':"",i=n.trim()||"<!-- HTML box was empty or could not be fetched. -->",s=t.trim()||"/* CSS box was empty or could not be fetched. */",u=r.trim()||"// JS box was empty or could not be fetched.",c=b(e.canonicalUrl),d=a?`
  <!-- ===== FETCH BLOCKED NOTICE ===== -->
  <section style="margin:0 0 20px;padding:14px 16px;border-radius:8px;background:#fff3cd;border:1px solid #ffe69c;color:#664d03;font:14px/1.5 system-ui,sans-serif;">
    <strong>CodePen blocked an automated fetch for this Pen.</strong><br>
    The HTML, CSS, and JS sections below are empty placeholders. Open the
    <a href="${c}" target="_blank" rel="noopener" style="color:#664d03;text-decoration:underline;">original Pen</a>
    and paste each editor's source into the matching section.
  </section>`:"";return`<!doctype html>
<!--
  Saved from ${c} with CodePen Library Saver.
  Source mode: uncombined (3 snippets pieced together).
  This file preserves the CodePen HTML, CSS, and JS boxes as separate sections
  so they can be manually refactored later.
  Original Pen: ${c}
-->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${b(e.title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${c}">
  <meta name="codepen:source-mode" content="uncombined">
  <!-- ===== CODEPEN CSS BOX START ===== -->
  <style>
${s}
  </style>
  <!-- ===== CODEPEN CSS BOX END ===== -->
</head>
<body>${d}
  <!-- ===== CODEPEN HTML BOX START ===== -->
${i}
  <!-- ===== CODEPEN HTML BOX END ===== -->

  <!-- ===== CODEPEN JS BOX START ===== -->
  <script${o}>
${F(u)}
  <\/script>
  <!-- ===== CODEPEN JS BOX END ===== -->

  <!-- ===== ORIGINAL CODEPEN LINK ===== -->
  <footer style="position:fixed;bottom:8px;right:8px;font:12px/1.4 system-ui,sans-serif;background:rgba(0,0,0,0.65);color:#fff;padding:6px 10px;border-radius:6px;z-index:2147483647;pointer-events:auto;">
    Source: <a href="${c}" target="_blank" rel="noopener" style="color:#9bd1ff;">${c}</a>
  </footer>
</body>
</html>`}function J(e){return/^\s*<!doctype/i.test(e)?e.trim():`<!doctype html>
${e.trim()}`}function B(e,n){let t=n.trim();return!t||f(t)?"":(/^<!doctype/i.test(t)||(t=`<!doctype html>
${t}`),t=/<meta\s+name=["']codepen:source["']/i.test(t)?t:t.replace(/<head([^>]*)>/i,`<head$1>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${b(e.canonicalUrl)}">`),$(e,t))}function $(e,n){const t=`<!-- Saved from ${e.canonicalUrl} with CodePen Library Saver. -->`;return n.trim().startsWith("<!doctype")?n.replace(/(\r?\n)/,`$1${t}$1`):`${t}
${n}`}function z(e){return`${`${e.title}-${e.author||e.user}-${e.slug}`.toLowerCase().replace(/&amp;/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90)||`codepen-${e.slug}`}.html`}function M(e,n){const t=e.replace(/\s+-\s+A Pen by .+$/i,"").trim();return t||(n?`Pen by ${n}`:"Untitled Pen")}function b(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function F(e){return e.replace(/<\/script/gi,"<\\/script")}function f(e){const n=e.trim().slice(0,500).toLowerCase();return n.includes("login")&&n.includes("codepen")&&n.includes("<html")||n.includes("pen not found or not available as a resource")||n.includes("this pen is not available")||n.includes("just a moment")||n.includes("enable javascript and cookies to continue")||n.includes("challenge-platform")||n.includes("cf_chl_")||n.includes("attention required! | cloudflare")}function X(e){return/^\s*import\s/m.test(e)||/^\s*export\s/m.test(e)||/\bimport\s*\(/.test(e)}async function g(){try{return{deepseekApiKey:(await U()).deepseekApiKey||""}}catch{return{deepseekApiKey:""}}}chrome.runtime.onInstalled.addListener(()=>{var e;(e=chrome.sidePanel)==null||e.setPanelBehavior({openPanelOnActionClick:!0})});chrome.action.onClicked.addListener(e=>{if(chrome.sidePanel){if(e.id){chrome.sidePanel.open({tabId:e.id});return}e.windowId&&chrome.sidePanel.open({windowId:e.windowId})}});chrome.runtime.onMessage.addListener((e,n,t)=>e.type==="SAVE_CURRENT_PEN"?(K().then(r=>t({ok:!0,pen:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not save this CodePen."})),!0):e.type==="SAVE_OPEN_CODEPEN_TABS"?(q().then(r=>t({ok:!0,pens:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not save open CodePen tabs."})),!0):e.type==="REPAIR_SAVED_PENS"?(V(e.pens).then(r=>t({ok:!0,pens:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not repair saved CodePens."})),!0):!1);async function K(){const e=await E();if(!(e!=null&&e.url)||!e.id)throw new Error("Open a CodePen tab first, then try saving again.");const n=C(e.url);if(!n)throw new Error("This tab does not look like a CodePen Pen URL.");const t=await T(e.id),r={...n,author:t==null?void 0:t.author,canonicalUrl:(t==null?void 0:t.canonicalUrl)||n.canonicalUrl,thumbnailUrl:t==null?void 0:t.thumbnailUrl,title:(t==null?void 0:t.title)||e.title||"Untitled Pen"},a=await k(e.id,n.user,n.slug);return w(r,{...await g(),prefetched:a})}async function q(){const e=await G(),n=new Map;for(const o of e){if(!o.url)continue;const i=C(o.url);i&&n.set(`${i.user}/${i.slug}`,{...o,parsed:i})}if(!n.size)throw new Error("No open CodePen Pen tabs were found.");const t=await E(),r=[],a=await g();for(const o of n.values()){o.id&&(await P(o.id,o.windowId),await W(350));const i=o.id?await T(o.id):null,s={...o.parsed,author:i==null?void 0:i.author,canonicalUrl:(i==null?void 0:i.canonicalUrl)||o.parsed.canonicalUrl,thumbnailUrl:i==null?void 0:i.thumbnailUrl,title:(i==null?void 0:i.title)||o.title||"Untitled Pen"},u=o.id?await k(o.id,o.parsed.user,o.parsed.slug):null;r.push(await w(s,{...a,prefetched:u}))}return t!=null&&t.id&&await P(t.id),r}async function V(e){var r;if(!e.length)throw new Error("There are no saved Pens to repair.");const n=[],t=await g();for(const a of e){const o=await w(a,t);n.push({...o,folder:a.folder||o.folder,lastDownloadId:a.lastDownloadId,savedAt:a.savedAt,tags:(r=a.tags)!=null&&r.length?a.tags:o.tags})}return n}async function E(){return new Promise(e=>{chrome.tabs.query({active:!0,currentWindow:!0},n=>e(n[0]))})}async function G(){return new Promise(e=>{chrome.tabs.query({url:["https://codepen.io/*/pen/*","https://codepen.io/*/full/*","https://codepen.io/*/debug/*"]},e)})}async function T(e){return new Promise(n=>{chrome.tabs.sendMessage(e,{type:"COLLECT_CODEPEN_PAGE"},t=>{if(t!=null&&t.ok&&"meta"in t){n(t.meta);return}n(null)})})}async function k(e,n,t){return new Promise(r=>{chrome.tabs.sendMessage(e,{type:"FETCH_PEN_SOURCE",user:n,slug:t},a=>{if(a!=null&&a.ok&&"source"in a){r(a.source);return}r(null)})})}async function P(e,n){return new Promise(t=>{chrome.tabs.update(e,{active:!0},()=>{if(typeof n=="number"&&chrome.windows){chrome.windows.update(n,{focused:!0},()=>t());return}t()})})}function W(e){return new Promise(n=>setTimeout(n,e))}
