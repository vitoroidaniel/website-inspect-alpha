<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>FleetInspect — Sign In</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c14;--surface:#13131f;--surface2:#1a1a2e;--surface3:#22223a;
  --border:#2a2a45;--border2:#353558;
  --white:#f0eef8;--dim:#8888aa;--muted:#44445a;
  --violet:#8b5cf6;--violet2:#7c3aed;--violet-glow:rgba(139,92,246,.18);
  --violet-light:rgba(139,92,246,.08);
  --green:#34d399;--red:#f87171;
  --shadow-v:0 0 32px rgba(139,92,246,.25);
}
html,body{height:100%;font-family:'DM Sans',sans-serif}
body{background:var(--bg);color:var(--white);min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(139,92,246,.12) 0%,transparent 65%);pointer-events:none;z-index:0}

.header{position:relative;z-index:10;padding:20px 28px;display:flex;align-items:center;gap:11px}
.logo-icon{width:34px;height:34px;background:var(--violet);border-radius:10px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(139,92,246,.4)}
.logo-icon svg{width:18px;height:18px}
.logo-text{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;letter-spacing:.3px;text-transform:uppercase}
.logo-text em{color:var(--violet);font-style:normal}

main{position:relative;z-index:1;flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:20px;width:100%;max-width:440px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.4),var(--shadow-v)}

.role-tabs{display:flex;border-bottom:1px solid var(--border)}
.rtab{flex:1;padding:15px;background:none;border:none;color:var(--dim);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;transition:all .18s;position:relative}
.rtab svg{width:14px;height:14px;flex-shrink:0}
.rtab.active{color:var(--white);background:var(--surface2)}
.rtab.active::after{content:'';position:absolute;bottom:0;left:16px;right:16px;height:2px;background:var(--violet);border-radius:2px 2px 0 0}

.card-body{padding:28px}
.step{display:none}.step.active{display:block}
.step-title{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;margin-bottom:4px}
.step-sub{font-size:13px;color:var(--dim);margin-bottom:22px;line-height:1.6}

.driver-list{display:flex;flex-direction:column;gap:6px;max-height:252px;overflow-y:auto;margin-bottom:16px;padding-right:2px}
.driver-list::-webkit-scrollbar{width:3px}
.driver-list::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
.driver-opt{display:flex;align-items:center;gap:12px;padding:11px 14px;border:1.5px solid var(--border);border-radius:12px;cursor:pointer;transition:all .15s}
.driver-opt:hover{border-color:var(--violet);background:var(--violet-light)}
.driver-opt.sel{border-color:var(--violet);background:var(--violet-light)}
.d-av{width:36px;height:36px;background:var(--surface3);border-radius:9px;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;color:var(--dim);flex-shrink:0}
.driver-opt.sel .d-av{background:var(--violet);color:#fff}
.d-info{flex:1;min-width:0}
.d-name{font-size:14px;font-weight:600;color:var(--white)}
.d-truck{font-size:11px;color:var(--dim);margin-top:1px}
.d-check{width:18px;height:18px;border:1.5px solid var(--border2);border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.driver-opt.sel .d-check{background:var(--violet);border-color:var(--violet)}
.driver-opt.sel .d-check svg{display:block}
.d-check svg{display:none;width:9px;height:9px}

.btn-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--violet);color:#fff;border:none;padding:14px 20px;border-radius:12px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;transition:all .18s;box-shadow:0 4px 20px rgba(139,92,246,.35)}
.btn-primary:hover{background:var(--violet2);box-shadow:0 6px 28px rgba(139,92,246,.45)}
.btn-primary:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}

/* PIN */
.pin-back{display:flex;align-items:center;gap:8px;margin-bottom:20px}
.btn-back{background:none;border:1.5px solid var(--border);border-radius:9px;color:var(--dim);padding:7px 13px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s}
.btn-back:hover{border-color:var(--violet);color:var(--violet)}
.sel-preview{flex:1;display:flex;align-items:center;gap:9px;background:var(--violet-light);border:1.5px solid var(--border2);border-radius:9px;padding:7px 12px}
.sel-av{width:26px;height:26px;background:var(--violet);border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:#fff;flex-shrink:0}
.sel-name{font-size:13px;font-weight:600;color:var(--violet)}

.pin-dots{display:flex;gap:11px;justify-content:center;margin:18px 0 22px}
.pdot{width:13px;height:13px;border:2px solid var(--border2);border-radius:50%;transition:all .18s}
.pdot.on{background:var(--violet);border-color:var(--violet);box-shadow:0 0 10px rgba(139,92,246,.5)}

.pin-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.pkey{background:var(--surface2);border:1.5px solid var(--border);border-radius:12px;color:var(--white);padding:18px 10px;font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;cursor:pointer;transition:all .12s;text-align:center}
.pkey:hover{border-color:var(--violet);background:var(--violet-light);color:var(--violet)}
.pkey:active{transform:scale(.96)}
.pkey.del{font-family:'DM Sans',sans-serif;font-size:13px;color:var(--dim)}
.pkey.zero{grid-column:2}

/* AGENT */
.form-group{margin-bottom:13px}
.form-label{display:block;font-size:11px;font-weight:600;color:var(--dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.form-input{display:block;width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;color:var(--white);padding:12px 14px;font-family:'DM Sans',sans-serif;font-size:14px;outline:none;transition:border-color .18s}
.form-input:focus{border-color:var(--violet)}
.form-input::placeholder{color:var(--muted)}
.err-msg{display:none;background:rgba(248,113,113,.08);border:1.5px solid rgba(248,113,113,.25);color:var(--red);font-size:12px;font-weight:500;padding:10px 14px;border-radius:10px;margin-top:12px}
.demo-hint{margin-top:16px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--dim);line-height:1.9}
.demo-hint strong{color:var(--white)}

footer{position:relative;z-index:1;padding:16px 28px;display:flex;justify-content:space-between}
footer span{font-size:11px;color:var(--muted)}
.online{display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<header class="header">
  <div class="logo-icon"><svg viewBox="0 0 18 18" fill="none"><rect x="1" y="6" width="16" height="2.5" rx="1.25" fill="white"/><rect x="1" y="10" width="16" height="2.5" rx="1.25" fill="white"/><rect x="3.5" y="2" width="11" height="2.5" rx="1.25" fill="white"/><circle cx="13.5" cy="15" r="1.8" fill="white"/><circle cx="4.5" cy="15" r="1.8" fill="white"/></svg></div>
  <div class="logo-text">Fleet<em>Inspect</em></div>
</header>

<main>
  <div class="card">
    <div class="role-tabs">
      <button class="rtab active" id="tabD" onclick="setRole('driver')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Driver
      </button>
      <button class="rtab" id="tabA" onclick="setRole('agent')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        Dispatcher / Admin
      </button>
    </div>
    <div class="card-body">
      <!-- DRIVER -->
      <div id="driverPanel">
        <div class="step active" id="dS1">
          <div class="step-title">Who are you?</div>
          <div class="step-sub">Pick your name, then enter your PIN.</div>
          <div class="driver-list" id="driverList"><div style="font-size:13px;color:var(--dim);padding:8px">Loading...</div></div>
          <button class="btn-primary" id="btnGoPin" onclick="goToPin()" disabled>Continue to PIN &nbsp;›</button>
        </div>
        <div class="step" id="dS2">
          <div class="pin-back">
            <button class="btn-back" onclick="backToList()">‹ Back</button>
            <div class="sel-preview">
              <div class="sel-av" id="selAv">?</div>
              <span class="sel-name" id="selName">—</span>
            </div>
          </div>
          <div class="step-title">Enter PIN</div>
          <div class="step-sub">Your 4-digit PIN from your dispatcher.</div>
          <div class="pin-dots" id="pinDots">
            <div class="pdot"></div><div class="pdot"></div><div class="pdot"></div><div class="pdot"></div>
          </div>
          <div class="pin-pad">
            <button class="pkey" onclick="pk('1')">1</button><button class="pkey" onclick="pk('2')">2</button><button class="pkey" onclick="pk('3')">3</button>
            <button class="pkey" onclick="pk('4')">4</button><button class="pkey" onclick="pk('5')">5</button><button class="pkey" onclick="pk('6')">6</button>
            <button class="pkey" onclick="pk('7')">7</button><button class="pkey" onclick="pk('8')">8</button><button class="pkey" onclick="pk('9')">9</button>
            <button class="pkey del" onclick="pdel()">⌫</button><button class="pkey zero" onclick="pk('0')">0</button>
          </div>
          <button class="btn-primary" id="btnPin" onclick="submitPin()" disabled><span id="pinTxt">Sign In</span> &nbsp;›</button>
          <div class="err-msg" id="pinErr"></div>
        </div>
      </div>
      <!-- AGENT -->
      <div id="agentPanel" style="display:none">
        <div class="step-title">Welcome back</div>
        <div class="step-sub">Sign in with your dispatcher credentials.</div>
        <div class="form-group"><label class="form-label">Username</label><input class="form-input" type="text" id="agU" autocapitalize="none" placeholder="username"></div>
        <div class="form-group"><label class="form-label">Password</label><input class="form-input" type="password" id="agP" placeholder="password"></div>
        <button class="btn-primary" id="btnAg" onclick="agentLogin()" style="margin-top:6px"><span id="agTxt">Sign In</span> &nbsp;›</button>
        <div class="err-msg" id="agErr"></div>
        <div class="demo-hint">Dispatcher: <strong>dispatch / dispatch123</strong><br>Admin: <strong>admin / admin123</strong></div>
      </div>
    </div>
  </div>
</main>

<footer><span><span class="online"></span>System online</span><span>FleetInspect © 2025</span></footer>

<script>
let sel=null,pin='';
function setRole(r){
  document.getElementById('tabD').classList.toggle('active',r==='driver');
  document.getElementById('tabA').classList.toggle('active',r==='agent');
  document.getElementById('driverPanel').style.display=r==='driver'?'block':'none';
  document.getElementById('agentPanel').style.display=r==='agent'?'block':'none';
}
async function loadDrivers(){
  try{
    const drivers=await(await fetch('/api/drivers/list')).json();
    const el=document.getElementById('driverList');
    if(!drivers.length){el.innerHTML='<div style="font-size:13px;color:var(--dim);padding:8px">No active drivers.</div>';return;}
    el.innerHTML=drivers.map(d=>{
      const i=(d.full_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      return`<div class="driver-opt" data-id="${d.id}" onclick="pickD(${d.id},'${esc(d.full_name)}','${esc(d.truck_model||'')}','${i}')">
        <div class="d-av">${i}</div>
        <div class="d-info"><div class="d-name">${esc(d.full_name)}</div><div class="d-truck">${esc(d.truck_model||'No truck')}${d.truck_number?' · '+esc(d.truck_number):''}</div></div>
        <div class="d-check"><svg viewBox="0 0 10 10" fill="none"><polyline points="2,5 4.5,7.5 8,2.5" stroke="white" stroke-width="1.5"/></svg></div>
      </div>`;
    }).join('');
  }catch(e){}
}
function pickD(id,name,truck,init){
  sel={id,name,truck,init};
  document.querySelectorAll('.driver-opt').forEach(el=>el.classList.toggle('sel',parseInt(el.dataset.id)===id));
  document.getElementById('btnGoPin').disabled=false;
}
function goToPin(){
  if(!sel)return;
  document.getElementById('selAv').textContent=sel.init;
  document.getElementById('selName').textContent=sel.name;
  pin='';renderDots();
  document.getElementById('dS1').classList.remove('active');
  document.getElementById('dS2').classList.add('active');
  document.getElementById('pinErr').style.display='none';
}
function backToList(){pin='';document.getElementById('dS2').classList.remove('active');document.getElementById('dS1').classList.add('active');}
function pk(d){if(pin.length>=4)return;pin+=d;renderDots();if(pin.length===4)submitPin();}
function pdel(){pin=pin.slice(0,-1);renderDots();}
function renderDots(){document.querySelectorAll('.pdot').forEach((d,i)=>d.classList.toggle('on',i<pin.length));document.getElementById('btnPin').disabled=pin.length<4;}
async function submitPin(){
  if(pin.length<4||!sel)return;
  const btn=document.getElementById('btnPin'),txt=document.getElementById('pinTxt'),err=document.getElementById('pinErr');
  btn.disabled=true;txt.textContent='Verifying...';err.style.display='none';
  try{
    const r=await fetch('/api/driver/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({driverId:sel.id,pin})});
    if(!r.ok){err.textContent='Incorrect PIN. Try again.';err.style.display='block';pin='';renderDots();txt.textContent='Sign In';btn.disabled=false;return;}
    window.location.href='/driver/inspect';
  }catch(e){err.textContent='Connection error.';err.style.display='block';txt.textContent='Sign In';btn.disabled=false;}
}
document.addEventListener('keydown',e=>{if(document.getElementById('agentPanel').style.display!=='none'&&e.key==='Enter')agentLogin();});
async function agentLogin(){
  const u=document.getElementById('agU').value.trim(),p=document.getElementById('agP').value;
  const btn=document.getElementById('btnAg'),txt=document.getElementById('agTxt'),err=document.getElementById('agErr');
  if(!u||!p){err.textContent='Enter username and password.';err.style.display='block';return;}
  btn.disabled=true;txt.textContent='Signing in...';err.style.display='none';
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    if(!r.ok){err.textContent=d.error||'Invalid credentials.';err.style.display='block';txt.textContent='Sign In';btn.disabled=false;return;}
    window.location.href='/agent/dashboard';
  }catch(e){err.textContent='Connection error.';err.style.display='block';txt.textContent='Sign In';btn.disabled=false;}
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
loadDrivers();
</script>
</body>
</html>
