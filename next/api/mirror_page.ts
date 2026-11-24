// The Mirror contributor page on the web (Design Package v1 build review 1, W01–W06): served by the Edge Function at GET /m/:slug when a
// browser asks for HTML. Plain HTML with the app's tokens; one small script talks to the same function. Nothing here ever shows another
// contributor's words or who they are: the page knows only the owner's first name and its own answers.
//   W01 welcome and sign-in (Apple and Google are wired but off until the providers exist; in preview, "Continue as a test friend");
//   W02 how you know them and for how long; W03–W05 the three prompts (the third optional, with Skip); the one label follow-up;
//   W06 thank you, Add another moment, Delete my answer; and the three one-line states (paused, no longer works, approval first).

export interface MirrorPage {
  open: boolean;
  reason: string | null;
  owner_name: string | null;
  who: string | null;
  prompts: string[];
  how_known: readonly string[];
  line: string | null;
  /** The owner's one question (v1.60), or null. */
  question?: string | null;
  preview?: boolean;
  test_friends?: { persona: string; name: string }[];
}

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );

export function mirrorPageHtml(page: MirrorPage, slug: string, apiBase: string, anonKey: string): string {
  const name = page.owner_name ?? "";
  const initial = name.slice(0, 1).toUpperCase();
  const data = JSON.stringify({ page, slug, apiBase, anonKey }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Mirror · ${esc(name) || "Presence"}</title>
<style>
:root{--bg:#EDE4DA;--ink:#1C1A1F;--sec:#3B353F;--muted:#5E5660;--ember:#D9662E;--solid:#FBF8F4;--tint:rgba(236,230,223,.8)}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,'SF Pro Text',system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.4}
.bg{position:fixed;inset:0;background:radial-gradient(120% 60% at 50% -10%,rgba(240,179,90,.28),transparent 60%),linear-gradient(180deg,#F6EFE7 0%,#EDE4DA 100%);z-index:-1}
.wrap{max-width:440px;margin:0 auto;padding:62px 20px 120px;min-height:100vh;position:relative}
.top{display:flex;align-items:center;justify-content:space-between;height:44px;margin-bottom:28px}
.glass{background:rgba(255,253,250,.36);-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);border:.5px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 10px 30px rgba(70,45,30,.14)}
.ib{width:44px;height:44px;border-radius:22px;border:0;display:flex;align-items:center;justify-content:center;color:var(--ink);cursor:pointer;font:inherit;background:rgba(255,253,250,.36)}
.ib[hidden]{display:none}
.initial{width:34px;height:34px;border-radius:17px;background:#E8B98F;color:#2F2A33;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center}
.bar{position:absolute;left:76px;right:76px;top:82px;height:5px;border-radius:3px;background:rgba(28,26,31,.1)}
.bar span{display:block;height:5px;border-radius:3px;background:var(--ember);transition:width .3s}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#2F2A33;margin:0 0 12px 4px}
h1,h2{margin:0 0 6px 4px;font-size:28px;line-height:1.15;font-weight:400;letter-spacing:-.4px}
p{margin:12px 4px;font-size:17px}.muted{color:var(--muted)}.sec{color:var(--sec)}.foot{font-size:13px;color:var(--muted)}
.box{position:relative;background:var(--solid);border-radius:20px;padding:16px 16px 60px;min-height:210px}
textarea{width:100%;min-height:150px;border:0;background:transparent;font:inherit;font-size:17px;line-height:1.5;color:var(--ink);resize:vertical;outline:none}
textarea::placeholder{color:var(--muted)}
.mic{position:absolute;right:12px;bottom:12px;width:40px;height:40px;border-radius:20px;border:0;background:var(--tint);color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center}
.mic.on{background:var(--ember);color:#fff}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:56px;border-radius:28px;border:0;font:inherit;font-size:17px;font-weight:600;cursor:pointer;margin-top:12px}
.ember{background:var(--ember);color:#fff;box-shadow:0 6px 18px rgba(217,102,46,.32)}.ember:disabled{opacity:.45;box-shadow:none;cursor:default}
.tint{background:var(--tint);color:var(--ink)}.plain{background:transparent;color:var(--ink)}.danger{background:transparent;color:#B5372A}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 4px 20px}
.chip{height:40px;padding:0 16px;border-radius:20px;border:.5px solid rgba(28,26,31,.14);background:var(--solid);font:inherit;font-size:15px;color:var(--ink);cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
select{width:100%;height:48px;border-radius:14px;border:.5px solid rgba(28,26,31,.14);background:var(--solid);font:inherit;font-size:16px;padding:0 14px;color:var(--ink)}
.state{text-align:center;padding-top:40vh}
button:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.hr{height:.5px;background:rgba(28,26,31,.14);margin:24px 0}
.lnk{color:var(--ink)}
</style>
</head>
<body>
<div class="bg" aria-hidden="true"></div>
<div class="wrap">
  <div class="top">
    <button class="ib" id="back" aria-label="Back" hidden>&#8249;</button>
    <span></span>
    <span class="initial" aria-hidden="true">${esc(initial)}</span>
  </div>
  <div class="bar" id="bar" hidden><span style="width:0%"></span></div>
  <main id="main" aria-live="polite"></main>
  <p class="foot" style="position:fixed;left:0;right:0;bottom:16px;text-align:center;margin:0">kenember.com</p>
</div>
<script id="data" type="application/json">${data}</script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var page = D.page, name = page.owner_name || 'them', prompts = page.prompts || [];
  var main = document.getElementById('main'), back = document.getElementById('back'), bar = document.getElementById('bar');
  var state = { step: 'welcome', friend: null, how_known: null, how_long: null, happening: '', did: '', mattered: '', followup: '', contribution_id: null };
  var HOW = [['partner','Partner'],['family','Family'],['friend','Friend'],['coworker','Coworker'],['other','Other']];
  var LONG = [['under_a_year','Under a year'],['one_to_five_years','1 to 5 years'],['over_five_years','Over 5 years']];
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function el(html){ main.innerHTML = html; window.scrollTo(0,0); }
  function progress(n){ bar.hidden = !n; if (n) bar.firstElementChild.style.width = (n/4*100)+'%'; }
  function speechOk(){ return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; }
  function wire(stepName, prev){ back.hidden = !prev; back.onclick = prev ? function(){ go(prev); } : null; state.step = stepName; }
  function oneLine(text){ progress(0); back.hidden = true; el('<div class="state"><p class="sec">'+esc(text)+'</p></div>'); }

  function go(step){
    if (!page.open) { return oneLine(page.reason === 'paused' ? name+' has paused this link for now.' : 'This link no longer works.'); }
    if (step === 'welcome') return welcome();
    if (step === 'how') return how();
    if (step === 'p1') return prompt(1);
    if (step === 'p2') return prompt(2);
    if (step === 'p3') return prompt(3);
    if (step === 'followup') return followup();
    if (step === 'thanks') return thanks();
  }
  function welcome(){
    wire('welcome', null); progress(0);
    var friends = (page.test_friends || []).map(function(f){ return '<option value="'+esc(f.persona)+'">'+esc(f.name)+'</option>'; }).join('');
    el((page.question ? '<p class="eyebrow">'+esc(name)+' asked you one thing</p><h1 id="question">'+esc(page.question)+'</h1>'
                      : '<h1>'+esc(name)+' asked for your perspective</h1>')+
       '<p class="sec">Tell one moment you saw. '+esc(name)+' never sees your words or who you are.</p>'+
       '<button class="btn glass" id="apple" aria-disabled="true">Continue with Apple</button>'+
       '<button class="btn glass" id="google" aria-disabled="true">Continue with Google</button>'+
       (page.preview ? '<div class="hr"></div><label class="muted" for="friend" style="margin-left:4px">Preview build: continue as a test friend</label><select id="friend"><option value="">Choose a name</option>'+friends+'</select>'+
       '<button class="btn ember" id="asfriend" disabled>Continue as a test friend</button>' : '')+
       '<p class="foot" style="text-align:center">Signing in keeps Mirror fair. You must be 18 or older.</p>'+
       '<p class="foot" style="text-align:center"><a class="lnk" href="https://kenember.com">What is Presence?</a> · Terms · Privacy</p>');
    var note = function(){ var p = document.createElement('p'); p.className='foot'; p.style.textAlign='center'; p.textContent='Sign-in is not switched on yet.'; main.insertBefore(p, document.getElementById('apple')); };
    document.getElementById('apple').onclick = note; document.getElementById('google').onclick = note;
    if (page.preview) {
      var sel = document.getElementById('friend'), btn = document.getElementById('asfriend');
      sel.onchange = function(){ btn.disabled = !sel.value; };
      btn.onclick = function(){ state.friend = sel.value; go('how'); };
    }
  }
  function chips(id, rows, chosen){ return '<div class="chips" id="'+id+'">'+rows.map(function(r){ return '<button class="chip" type="button" data-v="'+r[0]+'" aria-pressed="'+(chosen===r[0])+'">'+r[1]+'</button>'; }).join('')+'</div>'; }
  function pick(id, key, then){ var box = document.getElementById(id); box.onclick = function(e){ var b = e.target.closest('.chip'); if(!b) return; state[key] = b.dataset.v; Array.prototype.forEach.call(box.children, function(c){ c.setAttribute('aria-pressed', c===b); }); then(); }; }
  function how(){
    wire('how', 'welcome'); progress(1);
    el('<h2>How do you know '+esc(name)+'?</h2>'+chips('hk', HOW, state.how_known)+'<p class="eyebrow">For how long?</p>'+chips('hl', LONG, state.how_long)+'<button class="btn ember" id="next" '+(state.how_known?'':'disabled')+'>Continue</button>');
    var next = document.getElementById('next');
    pick('hk','how_known', function(){ next.disabled = !state.how_known; }); pick('hl','how_long', function(){});
    next.onclick = function(){ go('p1'); };
  }
  function prompt(n){
    var key = ['happening','did','mattered'][n-1], prev = n===1?'how':'p'+(n-1);
    wire('p'+n, prev); progress(n+1);
    var optional = n===3;
    el('<p class="eyebrow">One moment · '+n+' of 3</p><h2>'+esc(prompts[n-1]||'')+'</h2>'+
       '<div class="box"><textarea id="t" placeholder="'+(optional?'Optional':'')+'">'+esc(state[key])+'</textarea>'+(speechOk()?'<button class="mic" id="mic" type="button" aria-label="Say it out loud">&#127908;</button>':'')+'</div>'+
       (optional?'<button class="btn plain" id="skip">Skip</button>':'')+'<button class="btn ember" id="next" '+(optional||state[key].trim().length>=3?'':'disabled')+'>'+(n===3?'Send':'Next')+'</button>');
    var t = document.getElementById('t'), next = document.getElementById('next');
    t.oninput = function(){ state[key] = t.value; if(!optional) next.disabled = t.value.trim().length < 3; };
    if (speechOk()) voice(document.getElementById('mic'), t, function(v){ state[key] = v; if(!optional) next.disabled = v.trim().length < 3; });
    if (optional) document.getElementById('skip').onclick = function(){ state.mattered=''; submit(); };
    next.onclick = function(){ if (n===3) submit(); else go('p'+(n+1)); };
  }
  function voice(btn, t, onText){
    var R = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null;
    btn.onclick = function(){
      if (rec) { rec.stop(); return; }
      rec = new R(); rec.continuous = true; rec.interimResults = true; var base = t.value;
      rec.onresult = function(e){ var s=''; for (var i=0;i<e.results.length;i++) s += e.results[i][0].transcript; t.value = (base ? base + ' ' : '') + s; onText(t.value); };
      rec.onend = function(){ rec = null; btn.classList.remove('on'); btn.setAttribute('aria-label','Say it out loud'); };
      rec.start(); btn.classList.add('on'); btn.setAttribute('aria-label','Done');
    };
  }
  function body(extra){
    var b = { how_known: state.how_known || 'other', how_long: state.how_long, happening: state.happening, did: state.did, mattered: state.mattered };
    if (state.friend) b.test_friend = state.friend;
    for (var k in (extra||{})) b[k] = extra[k];
    return b;
  }
  function api(method, path, b){
    return fetch(D.apiBase + path, { method: method, headers: { 'content-type': 'application/json', 'apikey': D.anonKey }, body: b ? JSON.stringify(b) : undefined })
      .then(function(r){ return r.json().then(function(j){ return { status: r.status, json: j }; }); });
  }
  function busy(text){ progress(4); back.hidden = true; el('<div class="state"><p class="muted">'+esc(text)+'</p></div>'); }
  function submit(extra){
    busy('Sending…');
    api('POST', '/m/'+D.slug+'/contributions', body(extra)).then(function(r){
      var j = r.json || {};
      if (r.status === 403 && j.reason === 'closed') { page.open = false; page.reason = 'paused'; return go('welcome'); }
      if (r.status === 404) { page.open = false; page.reason = 'not_found'; return go('welcome'); }
      if (r.status >= 400) { return fail(j.ref); }
      state.contribution_id = j.contribution_id || null;
      if (j.state === 'ask_moment') return followup();
      if (j.state === 'waiting_approval') return oneLine(name+' will approve your request first.');
      if (j.state === 'concern') return concern(j);
      return thanks();
    }).catch(function(){ fail(null); });
  }
  function fail(ref){ progress(0); back.hidden=true; el('<div class="state"><p class="sec">Couldn\\u2019t reach Presence right now.</p><button class="btn tint" id="retry">Try again</button>'+(ref?'<p class="foot">Ref '+esc(ref)+'</p>':'')+'</div>'); document.getElementById('retry').onclick = function(){ submit(); }; }
  function followup(){
    wire('followup', null); progress(4);
    el('<p class="eyebrow">One moment · 2 of 3</p><h2>'+esc(prompts[1]||'')+'</h2><p class="sec">Can you think of one time you saw that? What happened?</p>'+
       '<div class="box"><textarea id="t" placeholder="One time I saw it\\u2026"></textarea></div><button class="btn plain" id="skip">Skip</button><button class="btn ember" id="next" disabled>Next</button>');
    var t = document.getElementById('t'), next = document.getElementById('next');
    t.oninput = function(){ state.followup = t.value; next.disabled = t.value.trim().length < 3; };
    document.getElementById('skip').onclick = function(){ thanks(); };
    next.onclick = function(){ state.did = (state.did ? state.did + ' ' : '') + state.followup; submit({ followup: true }); };
  }
  function concern(j){
    progress(0); back.hidden = true;
    var res = (j.resources && j.resources.resources) || [];
    el('<div class="state"><p class="sec">'+esc(j.line || '')+'</p>'+res.map(function(x){ return '<p><a class="lnk" href="'+esc(x.url)+'">'+esc(x.label)+'</a></p>'; }).join('')+'</div>');
  }
  function thanks(){
    wire('thanks', null); progress(0);
    el('<h1>Thank you</h1><p class="sec">'+esc(name)+' will never see your words or who you are. If several people describe something similar, it may become an outside perspective on '+esc(name)+'\\u2019s map. '+esc(name)+' decides whether it fits.</p>'+
       '<div class="hr"></div><h2>Want your own map?</h2><p class="muted">Talk about your day. See what you believe.</p><a class="btn ember" href="https://kenember.com" style="text-decoration:none">Get Presence</a>'+
       '<button class="btn tint" id="another">Add another moment</button>'+(state.contribution_id?'<button class="btn danger" id="del">Delete my answer</button>':''));
    document.getElementById('another').onclick = function(){ state.happening=''; state.did=''; state.mattered=''; state.followup=''; state.contribution_id=null; go('p1'); };
    var del = document.getElementById('del');
    if (del) del.onclick = function(){
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Delete it? Tap again to confirm'; return; }
      busy('Removing…');
      api('DELETE', '/m/'+D.slug+'/contributions/'+state.contribution_id, body()).then(function(){ state.contribution_id = null; oneLine('Your answer was removed.'); }).catch(function(){ fail(null); });
    };
  }
  go('welcome');
})();
</script>
</body>
</html>`;
}
