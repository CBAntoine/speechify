// Builds a single .html file that plays the exported video with its chapters,
// searchable transcript, captions and summary. It needs no server: send it by
// email or chat, drop it in a shared drive, or host it anywhere static.

import { clock, type Cue, type OutputChapter, type TranscriptLine, toVTT } from './captions.ts';

export interface PlayerPageInput {
  title: string;
  createdAt: number;
  duration: number;
  video: Blob;
  summary?: string;
  actionItems?: string[];
  chapters: OutputChapter[];
  transcript: TranscriptLine[];
  cues: Cue[];
  cta?: { label: string; url: string };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function buildPlayerPage(p: PlayerPageInput): Promise<Blob> {
  const b64 = await blobToBase64(p.video);
  const data = {
    chapters: p.chapters,
    transcript: p.transcript,
    vtt: toVTT(p.cues),
    mime: p.video.type || 'video/mp4',
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const safeUrl = p.cta && /^https?:\/\//i.test(p.cta.url) ? p.cta.url : '';
  const date = new Date(p.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Shuttle">
<title>${esc(p.title)}</title>
<style>
:root{--bg:#f5f6f8;--panel:#ffffff;--ink:#14161b;--muted:#5d6470;--line:#e2e5ea;--accent:#e2462a;--hl:#fff1ec;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--panel:#171a20;--ink:#eceef2;--muted:#99a1ad;--line:#262a33;--accent:#ff6a4a;--hl:#2a1c18;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left)) 56px max(16px,env(safe-area-inset-right))}
header{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;margin-bottom:18px}
h1{font-size:clamp(22px,3vw,30px);line-height:1.15;margin:0;letter-spacing:-.01em;text-wrap:balance;flex:1 1 420px}
.meta{color:var(--muted);font-variant-numeric:tabular-nums}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
@media (max-width:900px){.grid{grid-template-columns:minmax(0,1fr)}}
video{width:100%;display:block;border-radius:12px;background:#000;aspect-ratio:16/9}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;align-items:center}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.chip[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.cta{margin-left:auto;background:var(--accent);color:#fff;text-decoration:none;border-radius:999px;padding:8px 16px;font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-top:16px}
.card h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.summary p{margin:0 0 10px;max-width:68ch}
.summary ul{margin:0;padding-left:18px}
.side{position:sticky;top:16px;display:flex;flex-direction:column;gap:16px;max-height:calc(100vh - 32px)}
.side .card{margin:0;display:flex;flex-direction:column;min-height:0}
.list{overflow:auto;min-height:0;margin:0 -8px}
button.row{display:grid;grid-template-columns:56px 1fr;gap:8px;width:100%;text-align:left;background:none;border:0;color:inherit;font:inherit;padding:7px 8px;border-radius:8px;cursor:pointer}
button.row:hover{background:var(--bg)}
button.row.on{background:var(--hl)}
.t{color:var(--accent);font-variant-numeric:tabular-nums;font-size:13px;padding-top:1px}
input[type=search]{width:100%;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:8px 10px;font:inherit;margin-bottom:10px}
mark{background:var(--accent);color:#fff;border-radius:3px;padding:0 2px}
footer{margin-top:28px;color:var(--muted);font-size:13px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
</head>
<body>
<div class="wrap">
<header><h1>${esc(p.title)}</h1><span class="meta">${esc(date)} · ${clock(p.duration)}</span></header>
<div class="grid">
<main>
<video id="v" controls playsinline preload="metadata"></video>
<div class="bar" role="group" aria-label="Playback speed">
${[1, 1.25, 1.5, 1.75, 2].map((r) => `<button class="chip" data-rate="${r}" aria-pressed="${r === 1}">${r}×</button>`).join('')}
${safeUrl ? `<a class="cta" href="${esc(safeUrl)}" target="_blank" rel="noopener">${esc(p.cta!.label || 'Learn more')}</a>` : ''}
</div>
${p.summary ? `<section class="card summary"><h2>Summary</h2>${p.summary.split(/\n{2,}/).map((para) => `<p>${esc(para)}</p>`).join('')}${p.actionItems?.length ? `<h2 style="margin-top:14px">Action items</h2><ul>${p.actionItems.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</section>` : ''}
</main>
<aside class="side">
${p.chapters.length ? `<section class="card"><h2>Chapters</h2><div class="list" id="chapters"></div></section>` : ''}
${p.transcript.length ? `<section class="card" style="flex:1"><h2>Transcript</h2><input type="search" id="q" placeholder="Search the transcript" aria-label="Search the transcript"><div class="list" id="tx"></div></section>` : ''}
</aside>
</div>
<footer>Recorded with Shuttle. This page plays offline; nothing is tracked.</footer>
</div>
<script type="application/json" id="data">${json}</script>
<script type="application/octet-stream" id="media">${b64}</script>
<script>
(function(){
var d=JSON.parse(document.getElementById('data').textContent);
var v=document.getElementById('v');
var b64=document.getElementById('media').textContent.trim();
function fmt(t){t=Math.max(0,Math.floor(t));var h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0')}
function toBlob(){try{var bin=atob(b64),n=bin.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i);return Promise.resolve(new Blob([u],{type:d.mime}))}catch(e){return fetch('data:'+d.mime+';base64,'+b64).then(function(r){return r.blob()})}}
toBlob().then(function(blob){v.src=URL.createObjectURL(blob);
if(d.vtt&&d.transcript.length){var tr=document.createElement('track');tr.kind='captions';tr.label='Captions';tr.srclang='en';tr.src=URL.createObjectURL(new Blob([d.vtt],{type:'text/vtt'}));v.appendChild(tr)}});
document.querySelectorAll('[data-rate]').forEach(function(b){b.onclick=function(){v.playbackRate=+b.dataset.rate;document.querySelectorAll('[data-rate]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))})}});
function rows(el,items,label){if(!el)return[];el.innerHTML='';return items.map(function(it){var b=document.createElement('button');b.className='row';b.innerHTML='<span class="t">'+fmt(it.t)+'</span><span></span>';b.lastChild.textContent=label(it);b.onclick=function(){v.currentTime=it.t+0.01;v.play()};el.appendChild(b);return b})}
var chRows=rows(document.getElementById('chapters'),d.chapters,function(c){return c.title});
var txEl=document.getElementById('tx');var txRows=rows(txEl,d.transcript,function(l){return l.text});
function active(list,t){var i=-1;for(var k=0;k<list.length;k++){if(list[k].t<=t+0.05)i=k;else break}return i}
var lastTx=-1,lastCh=-1;
v.addEventListener('timeupdate',function(){var t=v.currentTime;var a=active(d.transcript,t);if(a!==lastTx){if(txRows[lastTx])txRows[lastTx].classList.remove('on');if(txRows[a]){txRows[a].classList.add('on');if(!q||!q.value)txRows[a].scrollIntoView({block:'nearest'})}lastTx=a}
var c=active(d.chapters,t);if(c!==lastCh){if(chRows[lastCh])chRows[lastCh].classList.remove('on');if(chRows[c])chRows[c].classList.add('on');lastCh=c}});
var q=document.getElementById('q');
if(q)q.addEventListener('input',function(){var s=q.value.trim().toLowerCase();txRows.forEach(function(r,i){var text=d.transcript[i].text;var hit=!s||text.toLowerCase().indexOf(s)>=0;r.hidden=!hit;var span=r.lastChild;if(s&&hit){var j=text.toLowerCase().indexOf(s);span.innerHTML='';span.appendChild(document.createTextNode(text.slice(0,j)));var m=document.createElement('mark');m.textContent=text.slice(j,j+s.length);span.appendChild(m);span.appendChild(document.createTextNode(text.slice(j+s.length)))}else span.textContent=text})});
document.addEventListener('keydown',function(e){if(e.target.tagName==='INPUT')return;if(e.key===' '||e.key==='k'){e.preventDefault();v.paused?v.play():v.pause()}else if(e.key==='ArrowRight'||e.key==='l'){v.currentTime+=5}else if(e.key==='ArrowLeft'||e.key==='j'){v.currentTime-=5}});
})();
</script>
</body>
</html>`;
  return new Blob([html], { type: 'text/html' });
}
