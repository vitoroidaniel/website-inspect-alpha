// Kurtex - Driver Application
// Designed by Rekka Software

// Global state
const STEPS = [];
let S = {
  step: 0,
  inspId: null,
  photos: {},
  loc: null,
  user: null,
  type: 'pickup'
};

const TL = {
  pickup: 'PickUp Trailer',
  drop: 'Drop Trailer',
  general: 'General'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    // Check authentication
    const [mr, sr] = await Promise.all([
      fetch('/api/me'),
      fetch('/api/inspection-steps?type=pickup')
    ]);
    
    if (!mr.ok) {
      location.href = '/login';
      return;
    }
    
    const u = await mr.json();
    
    if (u.role !== 'driver') {
      location.href = '/agent/dashboard';
      return;
    }
    
    STEPS.length = 0;
    STEPS.push(...(await sr.json()));
    S.user = u;
    
    // Update UI
    document.getElementById('dName').textContent = u.name || u.username;
    document.getElementById('dTruck').textContent = [u.truck_model, u.truck_number].filter(Boolean).join(' · ') || 'No truck assigned';
    document.getElementById('iName').textContent = u.name || '—';
    document.getElementById('iTruck').textContent = u.truck_model || '—';
    document.getElementById('iNum').textContent = u.truck_number || '—';
    
    updateStepCount();
    loadRecent();
    initGPS();
    await checkBiometricSetup();
  } catch (e) {
    location.href = '/login';
  }
}

// Check if biometric is set up
async function checkBiometricSetup() {
  try {
    const r = await fetch('/api/auth/webauthn/has-credential');
    const d = await r.json();
    const badge = document.getElementById('bioSetupBadge');
    if (badge) {
      badge.textContent = d.registered ? 'Setup' : 'Not Setup';
      badge.className = 'setting-status ' + (d.registered ? 'setup' : 'not-setup');
    }
  } catch (e) {}
}

// Inspection type selection
async function setType(t) {
  S.type = t;
  
  ['pickup', 'drop', 'general'].forEach(x => {
    const btn = document.getElementById('typeBtn' + x[0].toUpperCase() + x.slice(1));
    if (btn) btn.classList.toggle('active', x === t);
  });
  
  const res = await fetch(`/api/inspection-steps?type=${t}`);
  STEPS.length = 0;
  STEPS.push(...(await res.json()));
  
  updateStepCount();
}

function updateStepCount() {
  document.getElementById('iSteps').textContent = STEPS.length;
  document.getElementById('startBadge').textContent = STEPS.length + ' steps';
}

// GPS initialization
function initGPS() {
  if (!navigator.geolocation) {
    setGPS(false, 'GPS not available');
    return;
  }
  
  navigator.geolocation.getCurrentPosition(
    p => {
      S.loc = { lat: p.coords.latitude, lng: p.coords.longitude };
      setGPS(true, `GPS locked — ${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`);
    },
    () => setGPS(false, 'Location access denied'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function setGPS(ok, txt) {
  const dot = document.getElementById('gpsDot');
  const text = document.getElementById('gpsText');
  if (dot) dot.className = 'gps-dot ' + (ok ? 'on' : 'err');
  if (text) text.textContent = txt;
}

// Load recent inspections
async function loadRecent() {
  try {
    const rows = await (await fetch('/api/driver/inspections')).json();
    const el = document.getElementById('recentList');
    
    if (!rows.length) {
      el.innerHTML = '<p style="font-size:16px;color:var(--dim);font-weight:600">No inspections yet.</p>';
      return;
    }
    
    el.innerHTML = rows.slice(0, 5).map(i => `
      <div class="insp-row">
        <div>
          <div class="insp-meta">${fmtDate(i.submitted_at || i.started_at)}</div>
          <div class="insp-info">
            <span class="type-chip ${i.inspection_type || 'pickup'}">${TL[i.inspection_type || 'pickup']}</span>
            ${i.photo_count} photo${i.photo_count !== 1 ? 's' : ''}
          </div>
        </div>
        <div class="status-pill ${i.status}">${i.status === 'submitted' ? 'Submitted' : 'In Progress'}</div>
      </div>
    `).join('');
  } catch (e) {}
}

// Start new inspection
async function startInspection() {
  if (!STEPS.length) {
    alert('No steps configured. Contact your dispatcher.');
    return;
  }
  
  try {
    const r = await fetch('/api/inspections/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspection_type: S.type })
    });
    
    const d = await r.json();
    if (!r.ok) throw new Error();
    
    S.inspId = d.inspectionId;
    S.step = 0;
    S.photos = {};
    
    renderStep();
    showScreen('sInspect');
  } catch (e) {
    alert('Could not start. Check connection.');
  }
}

// Render current step
function renderStep() {
  const i = S.step;
  const s = STEPS[i];
  
  document.getElementById('sCtr').textContent = `${i + 1} / ${STEPS.length}`;
  document.getElementById('progFill').style.width = `${(i / STEPS.length) * 100}%`;
  document.getElementById('sLabel').textContent = s.label;
  document.getElementById('sEye').textContent = `STEP ${i + 1} OF ${STEPS.length}`;
  document.getElementById('sTitle').textContent = s.label;
  document.getElementById('sDesc').textContent = s.instruction;
  
  // Render dots
  document.getElementById('stepDots').innerHTML = STEPS.map((_, j) => 
    `<div class="sdot${j < i ? ' done' : j === i ? ' active' : ''}"></div>`
  ).join('');
  
  // Photo state
  const p = S.photos[i];
  const prev = document.getElementById('phPreview');
  const ph = document.getElementById('phPlaceholder');
  const badge = document.getElementById('phBadge');
  const rb = document.getElementById('retakeBtn');
  const cb = document.getElementById('camBtn');
  const pz = document.getElementById('photoZone');
  const bn = document.getElementById('btnNext');
  
  document.getElementById('phErr').style.display = 'none';
  document.getElementById('uploadOverlay').style.display = 'none';
  
  if (p) {
    prev.src = p.path;
    prev.style.display = 'block';
    ph.style.display = 'none';
    badge.style.display = 'flex';
    rb.style.display = 'block';
    cb.style.display = 'none';
    pz.classList.add('captured');
    pz.onclick = null;
    bn.disabled = false;
    bn.textContent = i === STEPS.length - 1 ? 'Review & Submit →' : 'Continue →';
  } else {
    prev.style.display = 'none';
    ph.style.display = 'flex';
    badge.style.display = 'none';
    rb.style.display = 'none';
    cb.style.display = 'flex';
    pz.classList.remove('captured');
    pz.onclick = triggerCam;
    bn.disabled = true;
    bn.textContent = 'Continue →';
  }
}

// Camera triggers
function triggerCam() {
  document.getElementById('camInput').click();
}

function retake(e) {
  e.stopPropagation();
  S.photos[S.step] = null;
  renderStep();
  document.getElementById('camInput').click();
}

// Handle photo upload
document.getElementById('camInput').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  
  const i = S.step;
  const prev = document.getElementById('phPreview');
  const ph = document.getElementById('phPlaceholder');
  const overlay = document.getElementById('uploadOverlay');
  const err = document.getElementById('phErr');
  
  // Preview
  const reader = new FileReader();
  reader.onload = e => {
    prev.src = e.target.result;
    prev.style.display = 'block';
    ph.style.display = 'none';
  };
  reader.readAsDataURL(file);
  
  overlay.style.display = 'flex';
  err.style.display = 'none';
  
  try {
    const form = new FormData();
    form.append('photo', file);
    form.append('stepLabel', STEPS[i].label);
    
    if (S.loc) {
      form.append('latitude', S.loc.lat);
      form.append('longitude', S.loc.lng);
    }
    
    const r = await fetch(`/api/inspections/${S.inspId}/step/${i + 1}/photo`, {
      method: 'POST',
      body: form
    });
    
    const d = await r.json();
    if (!r.ok) throw new Error();
    
    S.photos[i] = { path: d.path };
    renderStep();
  } catch (e) {
    overlay.style.display = 'none';
    prev.style.display = 'none';
    ph.style.display = 'flex';
    err.textContent = 'Upload failed — try again.';
    err.style.display = 'block';
  }
  
  this.value = '';
});

// Navigation
function nextStep() {
  if (!S.photos[S.step]) return;
  
  if (S.step === STEPS.length - 1) {
    showReview();
    return;
  }
  
  S.step++;
  renderStep();
  document.querySelector('.inspect-body').scrollTop = 0;
}

function prevStep() {
  if (S.step === 0) {
    showScreen('sHome');
    return;
  }
  
  S.step--;
  renderStep();
}

function goBackToPhotos() {
  S.step = STEPS.length - 1;
  renderStep();
  showScreen('sInspect');
}

// Review screen
function showReview() {
  document.getElementById('revCount').textContent = Object.keys(S.photos).length;
  
  document.getElementById('revGrid').innerHTML = STEPS.map((s, i) => {
    const p = S.photos[i];
    return `<div class="r-thumb">
      ${p ? `<img src="${p.path}" loading="lazy"><div class="r-thumb-ok"><svg viewBox="0 0 10 10" fill="none"><polyline points="2,5 4.5,7.5 8,2.5" stroke="white" stroke-width="2"/></svg></div>` : `<div class="r-missing">✕</div>`}
      <div class="r-thumb-num">${i + 1}</div>
    </div>`;
  }).join('');
  
  const tl = TL[S.type] || 'Inspection';
  document.getElementById('revType').textContent = tl + ' Inspection';
  document.getElementById('revDriver').textContent = S.user?.name || '—';
  document.getElementById('revTruck').textContent = S.user?.truck_model || '—';
  document.getElementById('revNum').textContent = S.user?.truck_number || '—';
  document.getElementById('revTypeRow').textContent = tl;
  document.getElementById('revTime').textContent = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  
  if (S.loc) {
    const lt = S.loc.lat.toFixed(5);
    const lg = S.loc.lng.toFixed(5);
    document.getElementById('revLoc').innerHTML = `<a href="https://maps.google.com/?q=${lt},${lg}" target="_blank">${lt}, ${lg}</a>`;
  } else {
    document.getElementById('revLoc').textContent = 'Not available';
  }
  
  showScreen('sReview');
}

// Submit inspection
async function submitInspection() {
  const btn = document.getElementById('btnSubmit');
  const txt = document.getElementById('submitTxt');
  
  btn.disabled = true;
  txt.textContent = 'Submitting…';
  
  try {
    const body = { notes: document.getElementById('notesInput').value };
    
    if (S.loc) {
      body.latitude = S.loc.lat;
      body.longitude = S.loc.lng;
    }
    
    const r = await fetch(`/api/inspections/${S.inspId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (!r.ok) throw new Error();
    
    showScreen('sSuccess');
  } catch (e) {
    btn.disabled = false;
    txt.textContent = 'Submit Inspection';
    alert('Submission failed.');
  }
}

// New inspection
function newInspection() {
  S = {
    step: 0,
    inspId: null,
    photos: {},
    loc: S.loc,
    user: S.user,
    type: S.type
  };
  
  document.getElementById('notesInput').value = '';
  loadRecent();
  showScreen('sHome');
}

// Screen navigation
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// Utilities
function fmtDate(dt) {
  if (!dt) return 'N/A';
  const d = new Date(dt.includes('T') ? dt : dt + 'Z');
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
}

// Export functions to window
window.setType = setType;
window.startInspection = startInspection;
window.triggerCam = triggerCam;
window.retake = retake;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.goBackToPhotos = goBackToPhotos;
window.submitInspection = submitInspection;
window.newInspection = newInspection;
window.logout = logout;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.setupBiometric = setupBiometric;
window.removeBiometric = removeBiometric;

// ============================================
// SETTINGS - BIOMETRIC SETUP
// ============================================

function openSettings() {
  document.getElementById('settingsModal').classList.add('open');
  checkBiometricSetupForSettings();
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

async function checkBiometricSetupForSettings() {
  try {
    const r = await fetch('/api/auth/webauthn/has-credential');
    const d = await r.json();
    const setupBtn = document.getElementById('setupBioBtn');
    const removeBtn = document.getElementById('removeBioBtn');
    const badge = document.getElementById('bioSetupBadge');
    
    if (d.registered) {
      setupBtn.style.display = 'none';
      removeBtn.style.display = 'block';
      badge.textContent = 'Setup';
      badge.className = 'setting-status setup';
    } else {
      setupBtn.style.display = 'block';
      removeBtn.style.display = 'none';
      badge.textContent = 'Not Setup';
      badge.className = 'setting-status not-setup';
    }
  } catch (e) {
    console.error(e);
  }
}

async function setupBiometric() {
  const alertEl = document.getElementById('settingsAlert');
  const setupBtn = document.getElementById('setupBioBtn');

  // Check browser support
  if (!window.PublicKeyCredential) {
    showAlert(alertEl, 'error', 'Face ID is not supported on this browser. Try Safari on iPhone/Mac or Chrome on Android.');
    return;
  }

  // Loading state
  setupBtn.disabled = true;
  setupBtn.textContent = 'Scanning…';
  alertEl.style.display = 'none';

  try {
    // Step 1: Get registration options from server
    const optRes = await fetch('/api/auth/webauthn/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!optRes.ok) {
      showAlert(alertEl, 'error', 'Could not start Face ID setup. Please try again.');
      return;
    }

    const opts = await optRes.json();

    // Step 2: Convert challenge and user.id to Uint8Array (required by WebAuthn API)
    opts.challenge = new TextEncoder().encode(opts.challenge);
    opts.user.id = Uint8Array.from(atob(opts.user.id), x => x.charCodeAt(0));

    // Step 3: Trigger Face ID / Touch ID scan on device
    const credential = await navigator.credentials.create({ publicKey: opts });

    // Step 4: Convert credential ID to base64 for storage
    const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));

    // Step 5: Get public key safely (getPublicKey() may return null on some browsers)
    let publicKey = '';
    try {
      const pkBuffer = credential.response.getPublicKey
        ? credential.response.getPublicKey()
        : null;
      if (pkBuffer) {
        publicKey = btoa(String.fromCharCode(...new Uint8Array(pkBuffer)));
      }
    } catch (_) {
      // Public key extraction not critical for this implementation
    }

    // Step 6: Save credential to server
    const regRes = await fetch('/api/auth/webauthn/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: credId,
        publicKey: publicKey,
        transports: ['internal']
      })
    });

    const regData = await regRes.json();

    if (!regRes.ok) {
      showAlert(alertEl, 'error', regData.error || 'Registration failed. Please try again.');
      return;
    }

    showAlert(alertEl, 'ok', '✅ Face ID set up! You can now log in with Face ID on the login screen.');
    checkBiometricSetupForSettings();

  } catch (e) {
    console.error('Face ID setup error:', e);
    if (e.name === 'NotAllowedError') {
      // User cancelled — no error shown
    } else if (e.name === 'NotSupportedError') {
      showAlert(alertEl, 'error', 'Face ID is not supported on this device.');
    } else if (e.name === 'InvalidStateError') {
      showAlert(alertEl, 'error', 'Face ID already registered on this device.');
    } else {
      showAlert(alertEl, 'error', 'Setup failed: ' + (e.message || 'Please try again.'));
    }
  } finally {
    setupBtn.disabled = false;
    setupBtn.textContent = 'Setup';
  }
}

async function removeBiometric() {
  if (!confirm('Remove biometric login? You can set it up again anytime.')) return;
  
  const alertEl = document.getElementById('settingsAlert');
  
  try {
    const r = await fetch('/api/auth/webauthn/remove-credential', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    showAlert(alertEl, 'ok', 'Biometric removed');
    checkBiometricSetupForSettings();
  } catch (e) {
    showAlert(alertEl, 'error', 'Failed to remove biometric');
  }
}

function showAlert(el, type, msg) {
  el.textContent = msg;
  el.style.color = type === 'ok' ? '#16a34a' : 'var(--red)';
  el.style.borderColor = type === 'ok' ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)';
  el.style.background = type === 'ok' ? 'var(--green-light)' : 'var(--red-light)';
  el.style.display = 'block';
  
  if (type === 'ok') setTimeout(() => el.style.display = 'none', 3000);
}

