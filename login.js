// Kurtex - Login Application
// Designed by Rekka Software

const API = {
  login: '/api/login',
  webAuthnLoginOptions: '/api/auth/webauthn/login-options',
  webAuthnLogin: '/api/auth/webauthn/login',
  hasCredential: '/api/auth/webauthn/has-credential'
};

let currentTab = 'driver';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initBiometricLogin();
  setupEnterKeySupport();
});

// Tab switching
function setTab(t) {
  currentTab = t;
  document.getElementById('tabDriver').classList.toggle('active', t === 'driver');
  document.getElementById('tabAgent').classList.toggle('active', t === 'agent');
  document.getElementById('panelDriver').classList.toggle('active', t === 'driver');
  document.getElementById('panelAgent').classList.toggle('active', t === 'agent');
}

// Enter key support
function setupEnterKeySupport() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (document.getElementById('panelDriver').classList.contains('active')) loginDriver();
    else loginAgent();
  });
}

// Main login function
async function doLogin(username, password, keepSignedIn, errEl, btnEl, txtEl) {
  btnEl.disabled = true;
  txtEl.textContent = 'Signing in…';
  errEl.style.display = 'none';
  
  try {
    const r = await fetch(API.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, keepSignedIn })
    });
    const d = await r.json();
    
    if (!r.ok) {
      showErr(errEl, d.error || 'Invalid credentials');
      btnEl.disabled = false;
      txtEl.textContent = 'Sign In';
      return;
    }
    
    window.location.href = d.role === 'driver' ? '/driver/inspect' : '/agent/dashboard';
  } catch (e) {
    showErr(errEl, 'Connection error. Try again.');
    btnEl.disabled = false;
    txtEl.textContent = 'Sign In';
  }
}

function loginDriver() {
  doLogin(
    document.getElementById('dUser').value.trim(),
    document.getElementById('dPass').value,
    document.getElementById('dKeep').checked,
    document.getElementById('dErr'),
    document.getElementById('dLoginBtn'),
    document.getElementById('dLoginTxt')
  );
}

function loginAgent() {
  doLogin(
    document.getElementById('aUser').value.trim(),
    document.getElementById('aPass').value,
    document.getElementById('aKeep').checked,
    document.getElementById('aErr'),
    document.getElementById('aLoginBtn'),
    document.getElementById('aLoginTxt')
  );
}

// ============================================
// BIOMETRIC LOGIN (Face ID / Fingerprint)
// ============================================

const bioSupported = window.PublicKeyCredential && 
                     typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';

// Check if biometric is available
async function initBiometricLogin() {
  if (!bioSupported) return;
  try {
    const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!ok) return;
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isMac = /Mac/.test(ua) && !isIOS;
    const label = isIOS || isMac ? 'Face ID / Touch ID' : 'Fingerprint / Face Unlock';
    ['dBioLabel', 'aBioLabel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = label;
    });
    document.getElementById('dBioBtn').style.display = 'flex';
    document.getElementById('aBioBtn').style.display = 'flex';
  } catch (e) {
    console.log('Biometric not available');
  }
}

// Perform biometric login
async function biometricLogin(panel) {
  const errEl = document.getElementById(panel === 'driver' ? 'dErr' : 'aErr');
  errEl.style.display = 'none';

  try {
    // Step 1: Get challenge + allowed credentials from server
    const optRes = await fetch(API.webAuthnLoginOptions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '' })
    });

    if (!optRes.ok) {
      showErr(errEl, 'Biometric not set up. Please log in with password first, then enable Face ID in Settings.');
      return;
    }

    const opts = await optRes.json();

    // No credentials registered anywhere
    if (!opts.allowCredentials || opts.allowCredentials.length === 0) {
      showErr(errEl, 'No biometric registered. Log in with password and set up Face ID in Settings.');
      return;
    }

    // Convert challenge from base64 to ArrayBuffer
    opts.challenge = base64ToBuffer(opts.challenge);

    // Convert each credential ID from base64 to ArrayBuffer
    opts.allowCredentials = opts.allowCredentials.map(c => ({
      ...c,
      id: base64ToBuffer(c.id)
    }));

    // Step 2: Trigger native Face ID / Touch ID scan on device
    const assertion = await navigator.credentials.get({ publicKey: opts });

    // Step 3: Send full assertion to server for cryptographic verification
    const r = await fetch(API.webAuthnLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: assertion.id,
        rawId: bufferToBase64(assertion.rawId),
        type: assertion.type,
        response: {
          authenticatorData: bufferToBase64(assertion.response.authenticatorData),
          clientDataJSON:    bufferToBase64(assertion.response.clientDataJSON),
          signature:         bufferToBase64(assertion.response.signature),
          userHandle:        assertion.response.userHandle
            ? bufferToBase64(assertion.response.userHandle)
            : null,
        }
      })
    });

    const d = await r.json();
    if (!r.ok) {
      showErr(errEl, d.error || 'Biometric login failed');
      return;
    }

    window.location.href = d.role === 'driver' ? '/driver/inspect' : '/agent/dashboard';

  } catch (e) {
    if (e.name === 'NotAllowedError') {
      // User cancelled — no error shown
    } else if (e.name === 'NotSupportedError') {
      showErr(errEl, 'Face ID is not supported on this device.');
    } else {
      showErr(errEl, 'Face ID login failed. Please use your password.');
    }
  }
}

// ── WebAuthn helpers ──────────────────────────────────────────────────────────
function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  // Handle both standard base64 and base64url
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - std.length % 4) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer;
}

// Show error message
function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// Export for HTML
window.setTab = setTab;
window.loginDriver = loginDriver;
window.loginAgent = loginAgent;
window.biometricLogin = biometricLogin;

