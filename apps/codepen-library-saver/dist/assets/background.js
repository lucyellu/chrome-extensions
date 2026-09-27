import{a as T}from"./storage.js";const E="https://api.deepseek.com/v1/chat/completions",A="deepseek-chat",L=6e4;async function I({meta:e,html:n,css:t,js:r,apiKey:a}){var s,l,p;if(!a.trim())return null;const o=new AbortController,i=setTimeout(()=>o.abort(),L);try{const m=await fetch(E,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${a.trim()}`},body:JSON.stringify({model:A,temperature:.2,messages:[{role:"system",content:O},{role:"user",content:j(e,n,t,r)}]}),signal:o.signal});if(!m.ok)return null;const u=await m.json(),c=((p=(l=(s=u==null?void 0:u.choices)==null?void 0:s[0])==null?void 0:l.message)==null?void 0:p.content)??"",d=_(c);return!d||!/<html[\s>]/i.test(d)?null:d}catch{return null}finally{clearTimeout(i)}}const O=`You are a senior front-end engineer. Your job is to take three CodePen editor boxes (HTML, CSS, JS) and emit a single self-contained HTML document that renders the same result as the original Pen when opened directly from disk.

Rules:
- Output a complete <!doctype html> document. No prose, no markdown fences, no commentary.
- Inline the CSS in a <style> block in <head>.
- Inline the JS in a <script> block just before </body>. Use type="module" only if the JS uses ES module syntax.
- If the JS or HTML clearly depends on libraries (React, Vue, Three.js, GSAP, p5, jQuery, lodash, Babel, TypeScript, etc.), add the matching CDN <script> or <link> tags to <head>. Prefer unpkg or cdnjs. If JSX/TSX is present, include @babel/standalone and mark the user script with type="text/babel".
- If the HTML editor content is a fragment (no <html>/<body>), wrap it inside <body>. If it is a full document, keep its structure and inject styles/scripts into the right slots.
- Do not invent application logic that was not present in the source. Preserve identifiers, class names, and structure.
- Escape any literal "<\/script>" inside JS so it does not break parsing.
- Add <meta name="generator" content="CodePen Library Saver"> and <meta name="codepen:source" content="<canonical url>"> in <head>.

Return ONLY the HTML document.`;function j(e,n,t,r){return`Source URL: ${e.canonicalUrl}
Title: ${e.title}
Author: ${e.author||e.user}

=== HTML EDITOR ===
${n||"(empty)"}

=== CSS EDITOR ===
${t||"(empty)"}

=== JS EDITOR ===
${r||"(empty)"}

Produce one runnable standalone HTML file as described.`}function _(e){let n=e.trim();const t=n.match(/^```(?:html|HTML)?\s*([\s\S]*?)```$/);return t&&(n=t[1].trim()),n}const w=["html","css","js"];function S(e){const t=new URL(e).pathname.replace(/\/+$/,""),r=t.match(/^\/([^/]+)\/(?:pen|full|debug|details)\/([A-Za-z0-9_-]+)(?:\/.*)?$/);if(r){const[,o,i]=r;return{user:o,slug:i,canonicalUrl:`https://codepen.io/${o}/pen/${i}`}}const a=t.match(/^\/([^/]+)\/embed\/(?:preview|result|pen)?\/?([A-Za-z0-9_-]+)(?:\/.*)?$/);if(a){const[,o,i]=a;return{user:o,slug:i,canonicalUrl:`https://codepen.io/${o}/pen/${i}`}}return null}async function b(e,n={}){var m,u;const t=await N(e.canonicalUrl),r={...e,author:e.author||(t==null?void 0:t.author_name)||e.user,thumbnailUrl:e.thumbnailUrl||(t==null?void 0:t.thumbnail_url)||`https://codepen.io/${e.user}/pen/${e.slug}/image/small.png`,title:K(e.title||(t==null?void 0:t.title)||"Untitled Pen",t==null?void 0:t.author_name)},o=f((m=n.prefetched)==null?void 0:m.debugHtml)||await R(r);let i="debug-html",s=o?M(r,o):"";if(!s){const c=await D(r,n.prefetched),d=((u=n.deepseekApiKey)==null?void 0:u.trim())||"",P=c.hasAnyCode&&d?await I({meta:r,html:c.html,css:c.css,js:c.js,apiKey:d}):null;P?(i="ai-integrated",s=g(r,J(P))):c.hasAnyCode?(i="raw-files",s=z(r,c.html,c.css,c.js)):(i="page-html",s=F(r))}const l=x(r),p=new Date().toISOString();return{...r,filename:l,html:s,id:`${r.user}/${r.slug}`,savedAt:p,sourceMode:i,tags:i==="ai-integrated"?["ai-integrated"]:[]}}async function D(e,n){const t={html:f(n==null?void 0:n.html),css:f(n==null?void 0:n.css),js:f(n==null?void 0:n.js),hasAnyCode:!1};return t.hasAnyCode=w.some(r=>t[r].trim().length>0),t.hasAnyCode?t:H(e)}function f(e){return!e||y(e)?"":e}async function H(e){const n=await Promise.all(w.map(async r=>{const a=`${e.canonicalUrl}.${r}`;try{const o=await fetch(a,{credentials:"include"});if(!o.ok)return[r,""];const i=await o.text();return y(i)?[r,""]:[r,i]}catch{return[r,""]}})),t=Object.fromEntries(n);return{...t,hasAnyCode:w.some(r=>t[r].trim().length>0)}}async function R(e){const n=[`https://codepen.io/${e.user}/debug/${e.slug}`,`https://cdpn.io/${e.user}/debug/${e.slug}`];for(const t of n)try{const r=await fetch(t,{credentials:"include"});if(!r.ok)continue;const a=await r.text();if(a.trim()&&!y(a))return a}catch{continue}return null}async function N(e){try{const n=`https://codepen.io/api/oembed?format=json&url=${encodeURIComponent(e)}`,t=await fetch(n,{credentials:"include"});return t.ok?await t.json():null}catch{return null}}function z(e,n,t,r){const a=W(r)?' type="module"':"",o=t.trim()?`<style>
${t.trim()}
</style>`:"",i=r.trim()?`<script${a}>
${V(r.trim())}
<\/script>`:"";return/<html[\s>]/i.test(n)?g(e,q(n,o,i)):`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${h(e.title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${h(e.canonicalUrl)}">
  <style>
    html, body {
      min-height: 100%;
    }
  </style>
${Y(o)}
</head>
<body>
${n.trim()}
${i}
</body>
</html>`}function F(e){const n=h(e.title),t=h(e.canonicalUrl),r=h(`https://codepen.io/${e.user}/embed/${e.slug}?default-tab=result&theme-id=light`);return`<!doctype html>
<!-- Saved from ${t} with CodePen Library Saver. Source fetch was blocked, so this file opens the live CodePen preview. -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${n}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${t}">
  <meta name="codepen:source-mode" content="live-preview">
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #ffffff;
    }

    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <iframe title="${n} live CodePen preview" src="${r}" allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; web-share"></iframe>
</body>
</html>`}function J(e){return/^\s*<!doctype/i.test(e)?e.trim():`<!doctype html>
${e.trim()}`}function M(e,n){let t=n.trim();return!t||y(t)?"":(/^<!doctype/i.test(t)||(t=`<!doctype html>
${t}`),t=/<meta\s+name=["']codepen:source["']/i.test(t)?t:t.replace(/<head([^>]*)>/i,`<head$1>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${h(e.canonicalUrl)}">`),g(e,t))}function q(e,n,t){let r=e;return n&&(r=/<\/head>/i.test(r)?r.replace(/<\/head>/i,`${n}
</head>`):`${n}
${r}`),t&&(r=/<\/body>/i.test(r)?r.replace(/<\/body>/i,`${t}
</body>`):`${r}
${t}`),r}function g(e,n){const t=`<!-- Saved from ${e.canonicalUrl} with CodePen Library Saver. -->`;return n.trim().startsWith("<!doctype")?n.replace(/(\r?\n)/,`$1${t}$1`):`${t}
${n}`}function x(e){return`${`${e.title}-${e.author||e.user}-${e.slug}`.toLowerCase().replace(/&amp;/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90)||`codepen-${e.slug}`}.html`}function K(e,n){const t=e.replace(/\s+-\s+A Pen by .+$/i,"").trim();return t||(n?`Pen by ${n}`:"Untitled Pen")}function h(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function V(e){return e.replace(/<\/script/gi,"<\\/script")}function y(e){const n=e.trim().slice(0,500).toLowerCase();return n.includes("login")&&n.includes("codepen")&&n.includes("<html")||n.includes("pen not found or not available as a resource")||n.includes("this pen is not available")||n.includes("just a moment")||n.includes("enable javascript and cookies to continue")||n.includes("challenge-platform")||n.includes("cf_chl_")||n.includes("attention required! | cloudflare")}function W(e){return/^\s*import\s/m.test(e)||/^\s*export\s/m.test(e)||/\bimport\s*\(/.test(e)}function Y(e){return e.split(`
`).map(n=>n&&`  ${n}`).join(`
`)}async function $(){try{return{deepseekApiKey:(await T()).deepseekApiKey||""}}catch{return{deepseekApiKey:""}}}chrome.runtime.onInstalled.addListener(()=>{var e;(e=chrome.sidePanel)==null||e.setPanelBehavior({openPanelOnActionClick:!0})});chrome.action.onClicked.addListener(e=>{if(chrome.sidePanel){if(e.id){chrome.sidePanel.open({tabId:e.id});return}e.windowId&&chrome.sidePanel.open({windowId:e.windowId})}});chrome.runtime.onMessage.addListener((e,n,t)=>e.type==="SAVE_CURRENT_PEN"?(B().then(r=>t({ok:!0,pen:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not save this CodePen."})),!0):e.type==="SAVE_OPEN_CODEPEN_TABS"?(G().then(r=>t({ok:!0,pens:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not save open CodePen tabs."})),!0):e.type==="REPAIR_SAVED_PENS"?(X(e.pens).then(r=>t({ok:!0,pens:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not repair saved CodePens."})),!0):!1);async function B(){const e=await v();if(!(e!=null&&e.url)||!e.id)throw new Error("Open a CodePen tab first, then try saving again.");const n=S(e.url);if(!n)throw new Error("This tab does not look like a CodePen Pen URL.");const t=await U(e.id),r={...n,author:t==null?void 0:t.author,canonicalUrl:(t==null?void 0:t.canonicalUrl)||n.canonicalUrl,thumbnailUrl:t==null?void 0:t.thumbnailUrl,title:(t==null?void 0:t.title)||e.title||"Untitled Pen"},a=await k(e.id,n.user,n.slug);return b(r,{...await $(),prefetched:a})}async function G(){const e=await Z(),n=new Map;for(const o of e){if(!o.url)continue;const i=S(o.url);i&&n.set(`${i.user}/${i.slug}`,{...o,parsed:i})}if(!n.size)throw new Error("No open CodePen Pen tabs were found.");const t=await v(),r=[],a=await $();for(const o of n.values()){o.id&&(await C(o.id,o.windowId),await Q(350));const i=o.id?await U(o.id):null,s={...o.parsed,author:i==null?void 0:i.author,canonicalUrl:(i==null?void 0:i.canonicalUrl)||o.parsed.canonicalUrl,thumbnailUrl:i==null?void 0:i.thumbnailUrl,title:(i==null?void 0:i.title)||o.title||"Untitled Pen"},l=o.id?await k(o.id,o.parsed.user,o.parsed.slug):null;r.push(await b(s,{...a,prefetched:l}))}return t!=null&&t.id&&await C(t.id),r}async function X(e){var r;if(!e.length)throw new Error("There are no saved Pens to repair.");const n=[],t=await $();for(const a of e){const o=await b(a,t);n.push({...o,folder:a.folder||o.folder,lastDownloadId:a.lastDownloadId,savedAt:a.savedAt,tags:(r=a.tags)!=null&&r.length?a.tags:o.tags})}return n}async function v(){return new Promise(e=>{chrome.tabs.query({active:!0,currentWindow:!0},n=>e(n[0]))})}async function Z(){return new Promise(e=>{chrome.tabs.query({url:["https://codepen.io/*/pen/*","https://codepen.io/*/full/*","https://codepen.io/*/debug/*"]},e)})}async function U(e){return new Promise(n=>{chrome.tabs.sendMessage(e,{type:"COLLECT_CODEPEN_PAGE"},t=>{if(t!=null&&t.ok&&"meta"in t){n(t.meta);return}n(null)})})}async function k(e,n,t){return new Promise(r=>{chrome.tabs.sendMessage(e,{type:"FETCH_PEN_SOURCE",user:n,slug:t},a=>{if(a!=null&&a.ok&&"source"in a){r(a.source);return}r(null)})})}async function C(e,n){return new Promise(t=>{chrome.tabs.update(e,{active:!0},()=>{if(typeof n=="number"&&chrome.windows){chrome.windows.update(n,{focused:!0},()=>t());return}t()})})}function Q(e){return new Promise(n=>setTimeout(n,e))}
