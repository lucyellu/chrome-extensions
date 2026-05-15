const h=["html","css","js"];function p(e){const t=new URL(e).pathname.replace(/\/+$/,""),r=t.match(/^\/([^/]+)\/(?:pen|full|debug|details)\/([A-Za-z0-9_-]+)(?:\/.*)?$/);if(r){const[,a,c]=r;return{user:a,slug:c,canonicalUrl:`https://codepen.io/${a}/pen/${c}`}}const o=t.match(/^\/([^/]+)\/embed\/(?:preview|result|pen)?\/?([A-Za-z0-9_-]+)(?:\/.*)?$/);if(o){const[,a,c]=o;return{user:a,slug:c,canonicalUrl:`https://codepen.io/${a}/pen/${c}`}}return null}async function u(e){const n=await b(e.canonicalUrl),t={...e,author:e.author||(n==null?void 0:n.author_name)||e.user,thumbnailUrl:e.thumbnailUrl||(n==null?void 0:n.thumbnail_url)||`https://codepen.io/${e.user}/pen/${e.slug}/image/small.png`,title:S(e.title||(n==null?void 0:n.title)||"Untitled Pen",n==null?void 0:n.author_name)},r=await w(t);let o="debug-html",a=r?y(t,r):"";if(!a){const s=await f(t);o="separated-source",a=s.hasAnyCode?P(t,s.html,s.css,s.js):C(t),s.hasAnyCode||(o="page-html")}const c=g(t),l=new Date().toISOString();return{...t,filename:c,html:a,id:`${t.user}/${t.slug}`,savedAt:l,sourceMode:o,tags:o==="separated-source"?["uncombined","needs-refactor"]:[]}}async function f(e){const n=await Promise.all(h.map(async r=>{const o=`${e.canonicalUrl}.${r}`;try{const a=await fetch(o,{credentials:"include"});if(!a.ok)return[r,""];const c=await a.text();return d(c)?[r,""]:[r,c]}catch{return[r,""]}})),t=Object.fromEntries(n);return{...t,hasAnyCode:h.some(r=>t[r].trim().length>0)}}async function w(e){const n=[`https://codepen.io/${e.user}/debug/${e.slug}`,`https://cdpn.io/${e.user}/debug/${e.slug}`];for(const t of n)try{const r=await fetch(t,{credentials:"include"});if(!r.ok)continue;const o=await r.text();if(o.trim()&&!d(o))return o}catch{continue}return null}async function b(e){try{const n=`https://codepen.io/api/oembed?format=json&url=${encodeURIComponent(e)}`,t=await fetch(n,{credentials:"include"});return t.ok?await t.json():null}catch{return null}}function P(e,n,t,r){const o=U(r)?' type="module"':"",a=n.trim()||"<!-- HTML box was empty. -->",c=t.trim()||"/* CSS box was empty. */",l=r.trim()||"// JS box was empty.";return`<!doctype html>
<!--
  Saved from ${i(e.canonicalUrl)} with CodePen Library Saver.
  Source mode: uncombined.
  This file preserves the CodePen HTML, CSS, and JS boxes as separate sections
  so they can be manually refactored later.
-->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${i(e.title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${i(e.canonicalUrl)}">
  <meta name="codepen:source-mode" content="uncombined">
  <!-- ===== CODEPEN CSS BOX START ===== -->
  <style>
${c}
  </style>
  <!-- ===== CODEPEN CSS BOX END ===== -->
</head>
<body>
  <!-- ===== CODEPEN HTML BOX START ===== -->
${a}
  <!-- ===== CODEPEN HTML BOX END ===== -->

  <!-- ===== CODEPEN JS BOX START ===== -->
  <script${o}>
${E(l)}
  <\/script>
  <!-- ===== CODEPEN JS BOX END ===== -->
</body>
</html>`}function y(e,n){let t=n.trim();return!t||d(t)?"":(/^<!doctype/i.test(t)||(t=`<!doctype html>
${t}`),t=/<meta\s+name=["']codepen:source["']/i.test(t)?t:t.replace(/<head([^>]*)>/i,`<head$1>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${i(e.canonicalUrl)}">`),$(e,t))}function $(e,n){const t=`<!-- Saved from ${e.canonicalUrl} with CodePen Library Saver. -->`;return n.trim().startsWith("<!doctype")?n.replace(/(\r?\n)/,`$1${t}$1`):`${t}
${n}`}function C(e){return`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${i(e.title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${i(e.canonicalUrl)}">
</head>
<body>
  <p>This Pen could not be fetched as standalone source. Open the original CodePen to copy private or unavailable content:</p>
  <p><a href="${i(e.canonicalUrl)}">${i(e.canonicalUrl)}</a></p>
</body>
</html>`}function g(e){return`${`${e.title}-${e.author||e.user}-${e.slug}`.toLowerCase().replace(/&amp;/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90)||`codepen-${e.slug}`}.html`}function S(e,n){const t=e.replace(/\s+-\s+A Pen by .+$/i,"").trim();return t||(n?`Pen by ${n}`:"Untitled Pen")}function i(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function E(e){return e.replace(/<\/script/gi,"<\\/script")}function d(e){const n=e.trim().slice(0,500).toLowerCase();return n.includes("login")&&n.includes("codepen")&&n.includes("<html")||n.includes("pen not found or not available as a resource")||n.includes("this pen is not available")||n.includes("just a moment")||n.includes("enable javascript and cookies to continue")||n.includes("challenge-platform")||n.includes("cf_chl_")}function U(e){return/^\s*import\s/m.test(e)||/^\s*export\s/m.test(e)||/\bimport\s*\(/.test(e)}chrome.runtime.onInstalled.addListener(()=>{var e;(e=chrome.sidePanel)==null||e.setPanelBehavior({openPanelOnActionClick:!0})});chrome.action.onClicked.addListener(e=>{if(chrome.sidePanel){if(e.id){chrome.sidePanel.open({tabId:e.id});return}e.windowId&&chrome.sidePanel.open({windowId:e.windowId})}});chrome.runtime.onMessage.addListener((e,n,t)=>e.type==="SAVE_CURRENT_PEN"?(v().then(r=>t({ok:!0,pen:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not save this CodePen."})),!0):e.type==="SAVE_OPEN_CODEPEN_TABS"?(O().then(r=>t({ok:!0,pens:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not save open CodePen tabs."})),!0):e.type==="REPAIR_SAVED_PENS"?(T(e.pens).then(r=>t({ok:!0,pens:r})).catch(r=>t({ok:!1,error:r instanceof Error?r.message:"Could not repair saved CodePens."})),!0):!1);async function v(){const e=await k();if(!(e!=null&&e.url)||!e.id)throw new Error("Open a CodePen tab first, then try saving again.");const n=p(e.url);if(!n)throw new Error("This tab does not look like a CodePen Pen URL.");const t=await m(e.id),r={...n,author:t==null?void 0:t.author,canonicalUrl:(t==null?void 0:t.canonicalUrl)||n.canonicalUrl,thumbnailUrl:t==null?void 0:t.thumbnailUrl,title:(t==null?void 0:t.title)||e.title||"Untitled Pen"};return u(r)}async function O(){const e=await A(),n=new Map;for(const r of e){if(!r.url)continue;const o=p(r.url);o&&n.set(`${o.user}/${o.slug}`,{...r,parsed:o})}if(!n.size)throw new Error("No open CodePen Pen tabs were found.");const t=[];for(const r of n.values()){const o=r.id?await m(r.id):null,a={...r.parsed,author:o==null?void 0:o.author,canonicalUrl:(o==null?void 0:o.canonicalUrl)||r.parsed.canonicalUrl,thumbnailUrl:o==null?void 0:o.thumbnailUrl,title:(o==null?void 0:o.title)||r.title||"Untitled Pen"};t.push(await u(a))}return t}async function T(e){var t;if(!e.length)throw new Error("There are no saved Pens to repair.");const n=[];for(const r of e){const o=await u(r);n.push({...o,folder:r.folder||o.folder,lastDownloadId:r.lastDownloadId,savedAt:r.savedAt,tags:(t=r.tags)!=null&&t.length?r.tags:o.tags})}return n}async function k(){return new Promise(e=>{chrome.tabs.query({active:!0,currentWindow:!0},n=>e(n[0]))})}async function A(){return new Promise(e=>{chrome.tabs.query({url:["https://codepen.io/*/pen/*","https://codepen.io/*/full/*","https://codepen.io/*/debug/*"]},e)})}async function m(e){return new Promise(n=>{chrome.tabs.sendMessage(e,{type:"COLLECT_CODEPEN_PAGE"},t=>{if(t!=null&&t.ok&&"meta"in t){n(t.meta);return}n(null)})})}
