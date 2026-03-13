const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');
const sharp = require('sharp');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = process.env.UPLOADS_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.params.inspectionId || 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `step_${req.params.step}_${Date.now()}.jpg`)
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'))
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(session({
  secret: process.env.SESSION_SECRET || 'kurtex-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const auth   = (req, res, next) => req.session.user ? next() : res.redirect('/login');
const agent  = (req, res, next) => req.session.user && ['agent','superadmin'].includes(req.session.user.role) ? next() : res.status(403).json({ error: 'Access denied' });
const admin  = (req, res, next) => req.session.user && req.session.user.role === 'superadmin' ? next() : res.status(403).json({ error: 'Admin only' });
const driver = (req, res, next) => req.session.user && req.session.user.role === 'driver' ? next() : res.status(403).json({ error: 'Access denied' });

// ── Pages ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return req.session.user.role === 'driver' ? res.redirect('/driver/inspect') : res.redirect('/agent/dashboard');
});
app.get('/login',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/driver/inspect',  auth, (req, res) => req.session.user.role === 'driver' ? res.sendFile(path.join(__dirname, 'public', 'driver.html')) : res.redirect('/agent/dashboard'));
app.get('/agent/dashboard', auth, (req, res) => req.session.user.role !== 'driver' ? res.sendFile(path.join(__dirname, 'public', 'agent.html')) : res.redirect('/driver/inspect'));

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, keepSignedIn } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE (username=? OR email=?) AND active=1').get(username, username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.cookie.maxAge = keepSignedIn ? 30*24*60*60*1000 : 8*60*60*1000;
    req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role, name: user.full_name, truck_model: user.truck_model, truck_number: user.truck_number };
    res.json({ role: user.role, name: user.full_name });
  } catch (e) { console.error('Login error:', e.message); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.session.user));

// ── WebAuthn (proper cryptographic verification) ──────────────────────────────
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

// Determine RP ID and origin from environment or request
function getRpId(req) {
  return process.env.RP_ID || req.hostname;
}
function getOrigin(req) {
  if (process.env.RP_ORIGIN) return process.env.RP_ORIGIN;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.hostname}`;
}

// Registration: generate challenge + options
app.post('/api/auth/webauthn/register-options', auth, async (req, res) => {
  try {
    const user = req.session.user;

    // Get existing credentials so we don't register duplicates
    const existingCreds = await db.prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id=?').all(user.id);

    const options = await generateRegistrationOptions({
      rpName: 'Kurtex',
      rpID: getRpId(req),
      userID: Buffer.from(String(user.id)),
      userName: user.username,
      userDisplayName: user.name,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials: existingCreds.map(c => ({
        id: Buffer.from(c.credential_id, 'base64'),
        type: 'public-key',
      })),
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'discouraged',
        authenticatorAttachment: 'platform',
      },
      supportedAlgorithmIDs: [-7, -257],
    });

    // Store challenge in session for verification
    req.session.webauthnChallenge = options.challenge;
    req.session.save();

    res.json(options);
  } catch (e) {
    console.error('WebAuthn register-options error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Registration: verify attestation and store credential
app.post('/api/auth/webauthn/register', auth, async (req, res) => {
  try {
    const user = req.session.user;
    const expectedChallenge = req.session.webauthnChallenge;

    if (!expectedChallenge) return res.status(400).json({ error: 'No challenge in session — please retry' });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: getOrigin(req),
        expectedRPID: getRpId(req),
        requireUserVerification: true,
      });
    } catch (verifyErr) {
      console.error('WebAuthn registration verification failed:', verifyErr.message);
      return res.status(400).json({ error: 'Biometric verification failed: ' + verifyErr.message });
    }

    const { verified, registrationInfo } = verification;
    if (!verified || !registrationInfo) {
      return res.status(400).json({ error: 'Registration not verified' });
    }

    const { credential } = registrationInfo;
    const credentialIdB64 = Buffer.from(credential.id).toString('base64');
    const publicKeyB64    = Buffer.from(credential.publicKey).toString('base64');
    const counter         = credential.counter ?? 0;
    const transports      = req.body.response?.transports || req.body.transports || ['internal'];

    // Upsert: one credential per user (replace if they re-register)
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(user.id);
    await db.prepare(
      'INSERT INTO webauthn_credentials (user_id,credential_id,public_key,counter,transports) VALUES (?,?,?,?,?)'
    ).run(user.id, credentialIdB64, publicKeyB64, counter, JSON.stringify(transports));

    // Clear challenge
    delete req.session.webauthnChallenge;
    req.session.save();

    res.json({ ok: true });
  } catch (e) {
    console.error('WebAuthn register error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove credential
app.post('/api/auth/webauthn/remove-credential', auth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.session.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to remove credential' }); }
});

// Authentication: generate challenge
app.post('/api/auth/webauthn/login-options', async (req, res) => {
  try {
    // Collect all registered credentials (allows any registered user to log in)
    const allCreds = await db.prepare('SELECT * FROM webauthn_credentials').all();

    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: allCreds.map(c => ({
        id: Buffer.from(c.credential_id, 'base64'),
        type: 'public-key',
        transports: JSON.parse(c.transports || '["internal"]'),
      })),
    });

    req.session.webauthnChallenge = options.challenge;
    req.session.save();

    res.json(options);
  } catch (e) {
    console.error('WebAuthn login-options error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Authentication: verify assertion signature
app.post('/api/auth/webauthn/login', async (req, res) => {
  try {
    const expectedChallenge = req.session.webauthnChallenge;
    if (!expectedChallenge) return res.status(400).json({ error: 'No challenge in session — please retry' });

    // Find the credential by ID
    const credentialId = req.body.rawId || req.body.id;
    const cred = await db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id=?').get(credentialId);
    if (!cred) return res.status(401).json({ error: 'Biometric not registered on this device' });

    const user = await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(cred.user_id);
    if (!user) return res.status(401).json({ error: 'Account not found or disabled' });

    // Verify the cryptographic signature
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: getOrigin(req),
        expectedRPID: getRpId(req),
        requireUserVerification: true,
        credential: {
          id: Buffer.from(cred.credential_id, 'base64'),
          publicKey: Buffer.from(cred.public_key, 'base64'),
          counter: cred.counter || 0,
        },
      });
    } catch (verifyErr) {
      console.error('WebAuthn auth verification failed:', verifyErr.message);
      return res.status(401).json({ error: 'Biometric verification failed — please try again' });
    }

    const { verified, authenticationInfo } = verification;
    if (!verified) return res.status(401).json({ error: 'Biometric not verified' });

    // Update counter to prevent replay attacks
    await db.prepare('UPDATE webauthn_credentials SET counter=? WHERE id=?')
      .run(authenticationInfo.newCounter, cred.id);

    // Clear challenge
    delete req.session.webauthnChallenge;

    // Create session
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    req.session.user = {
      id: user.id, username: user.username, email: user.email,
      role: user.role, name: user.full_name,
      truck_model: user.truck_model, truck_number: user.truck_number
    };
    req.session.save();

    res.json({ role: user.role, name: user.full_name });
  } catch (e) {
    console.error('WebAuthn login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/webauthn/has-credential', auth, async (req, res) => {
  try {
    const cred = await db.prepare('SELECT id FROM webauthn_credentials WHERE user_id=?').get(req.session.user.id);
    res.json({ registered: !!cred });
  } catch (e) { res.json({ registered: false }); }
});

// ── Inspection Steps ──────────────────────────────────────────────────────────
app.get('/api/inspection-steps', auth, async (req, res) => {
  try {
    const steps = await db.prepare('SELECT * FROM inspection_steps WHERE active=1 AND inspection_type=? ORDER BY step_number').all(req.query.type || 'pickup');
    res.json(steps);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Assets (Trailers) ─────────────────────────────────────────────────────────
app.get('/api/assets', auth, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM assets WHERE active=1 ORDER BY asset_number').all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Asset detail — info + full inspection history
app.get('/api/assets/:id', agent, async (req, res) => {
  try {
    const asset = await db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    const inspections = await db.prepare(
      `SELECT i.*, COUNT(p.id) as photo_count,
        SUM(CASE WHEN p.flagged=1 THEN 1 ELSE 0 END) as flagged_count
       FROM inspections i
       LEFT JOIN inspection_photos p ON p.inspection_id=i.id
       WHERE i.asset_id=? AND i.status='submitted'
       GROUP BY i.id ORDER BY i.submitted_at DESC`
    ).all(req.params.id);
    res.json({ ...asset, inspections });
  } catch (e) { console.error('Asset detail error:', e.message); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/assets', admin, async (req, res) => {
  try {
    const { asset_number, year, make, model, vin, license_plate, notes } = req.body;
    if (!asset_number) return res.status(400).json({ error: 'Asset number required' });
    if (await db.prepare('SELECT id FROM assets WHERE asset_number=? AND active=1').get(asset_number))
      return res.status(409).json({ error: 'Asset number already exists' });
    await db.prepare('INSERT INTO assets (asset_number,year,make,model,vin,license_plate,notes) VALUES (?,?,?,?,?,?,?)')
      .run(asset_number, year||'', make||'', model||'', vin||'', license_plate||'', notes||'');
    res.json({ ok: true });
  } catch (e) { console.error('Create asset error:', e.message); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/assets/:id', admin, async (req, res) => {
  try {
    const { asset_number, year, make, model, vin, license_plate, notes, active } = req.body;
    const asset = await db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    if (asset_number)           await db.prepare('UPDATE assets SET asset_number=? WHERE id=?').run(asset_number, req.params.id);
    if (year !== undefined)     await db.prepare('UPDATE assets SET year=? WHERE id=?').run(year, req.params.id);
    if (make !== undefined)     await db.prepare('UPDATE assets SET make=? WHERE id=?').run(make, req.params.id);
    if (model !== undefined)    await db.prepare('UPDATE assets SET model=? WHERE id=?').run(model, req.params.id);
    if (vin !== undefined)      await db.prepare('UPDATE assets SET vin=? WHERE id=?').run(vin, req.params.id);
    if (license_plate !== undefined) await db.prepare('UPDATE assets SET license_plate=? WHERE id=?').run(license_plate, req.params.id);
    if (notes !== undefined)    await db.prepare('UPDATE assets SET notes=? WHERE id=?').run(notes, req.params.id);
    if (active !== undefined)   await db.prepare('UPDATE assets SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/assets/:id', admin, async (req, res) => {
  try {
    await db.prepare('UPDATE assets SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Driver – Inspection ───────────────────────────────────────────────────────
app.post('/api/inspections/start', driver, async (req, res) => {
  try {
    const id = uuidv4(), u = req.session.user;
    const { inspection_type, asset_id } = req.body;
    const type = inspection_type || 'pickup';

    let assetData = {};
    if (asset_id) {
      const asset = await db.prepare('SELECT * FROM assets WHERE id=? AND active=1').get(asset_id);
      if (asset) {
        assetData = {
          asset_id: asset.id,
          asset_number: asset.asset_number,
          asset_year: asset.year,
          asset_make: asset.make,
          asset_model: asset.model,
          asset_vin: asset.vin,
          asset_license_plate: asset.license_plate
        };
      }
    }

    await db.prepare(`INSERT INTO inspections
      (id,driver_id,driver_name,truck_model,truck_number,asset_id,asset_number,asset_year,asset_make,asset_model,asset_vin,asset_license_plate,inspection_type,status,started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'${type}','in_progress',NOW())`)
      .run(id, u.id, u.name, u.truck_model||'N/A', u.truck_number||'',
        assetData.asset_id||null, assetData.asset_number||null, assetData.asset_year||null,
        assetData.asset_make||null, assetData.asset_model||null, assetData.asset_vin||null,
        assetData.asset_license_plate||null);

    res.json({ inspectionId: id, asset: assetData });
  } catch (e) { console.error('Start inspection error:', e.message); res.status(500).json({ error: 'Server error' }); }
});

// Photo upload with compression
app.post('/api/inspections/:inspectionId/step/:step/photo', driver, async (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const { inspectionId, step } = req.params;
    const { latitude, longitude, stepLabel } = req.body;

    try {
      const inspection = await db.prepare('SELECT id FROM inspections WHERE id=? AND driver_id=?').get(inspectionId, req.session.user.id);
      if (!inspection) return res.status(404).json({ error: 'Not found' });

      const compressedPath = req.file.path.replace(/\.[^.]+$/, '_compressed.jpg');
      await sharp(req.file.path).jpeg({ quality: 70 }).resize(1920, 1080, { fit: 'inside', withoutEnlargement: true }).toFile(compressedPath);
      fs.unlinkSync(req.file.path);
      fs.renameSync(compressedPath, req.file.path);

      const photoPath = `/uploads/${inspectionId}/${path.basename(req.file.path)}`;
      await db.prepare('INSERT INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,NOW())')
        .run(inspectionId, parseInt(step), stepLabel||null, photoPath, latitude||null, longitude||null);

      res.json({ ok: true, path: photoPath });
    } catch (e) {
      console.error('Photo upload error:', e.message);
      try {
        const photoPath = `/uploads/${inspectionId}/${req.file.filename}`;
        await db.prepare('INSERT INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,NOW())')
          .run(inspectionId, parseInt(step), stepLabel||null, photoPath, latitude||null, longitude||null);
        res.json({ ok: true, path: photoPath });
      } catch (e2) { res.status(500).json({ error: 'Failed to save photo' }); }
    }
  });
});

app.post('/api/inspections/:inspectionId/submit', driver, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { latitude, longitude, notes } = req.body;
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=? AND driver_id=?').get(inspectionId, req.session.user.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=?').all(inspectionId);
    if (!photos.length) return res.status(400).json({ error: 'No photos' });
    const loc = photos.find(p => p.latitude);
    await db.prepare(`UPDATE inspections SET status='submitted',submitted_at=NOW(),latitude=?,longitude=?,notes=? WHERE id=?`)
      .run(latitude||(loc?loc.latitude:null), longitude||(loc?loc.longitude:null), notes||'', inspectionId);
    res.json({ ok: true });
  } catch (e) { console.error('Submit error:', e.message); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/driver/inspections', driver, async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? GROUP BY i.id ORDER BY i.started_at DESC LIMIT 10`).all(req.session.user.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Resume in-progress inspection
app.get('/api/driver/inspections/in-progress', driver, async (req, res) => {
  try {
    const insp = await db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? AND i.status='in_progress' GROUP BY i.id ORDER BY i.started_at DESC LIMIT 1`).get(req.session.user.id);
    if (!insp) return res.json(null);
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(insp.id);
    res.json({ ...insp, photos });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Agent / Dispatcher ────────────────────────────────────────────────────────
app.get('/api/agent/drivers', agent, async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.truck_model,u.truck_number,u.active,COUNT(i.id) as total_inspections,MAX(i.submitted_at) as last_inspection,SUM(CASE WHEN i.status='submitted' THEN 1 ELSE 0 END) as submitted_count FROM users u LEFT JOIN inspections i ON i.driver_id=u.id WHERE u.role='driver' GROUP BY u.id ORDER BY u.full_name`).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/agent/drivers/:id/inspections', agent, async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? AND i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC`).all(req.params.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/agent/inspections/:id', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id);
    res.json({ ...insp, photos });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Flag / unflag a photo
app.patch('/api/agent/photos/:photoId/flag', agent, async (req, res) => {
  try {
    const { flagged, flag_note } = req.body;
    await db.prepare('UPDATE inspection_photos SET flagged=?,flag_note=? WHERE id=?').run(flagged ? 1 : 0, flag_note||'', req.params.photoId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Download ZIP
app.get('/api/agent/inspections/:id/download', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="inspection_${(insp.driver_name||'').replace(/[^a-z0-9]/gi,'_')}_${(insp.submitted_at||'').toString().split('T')[0]}.zip"`);
    const arc = archiver('zip');
    arc.pipe(res);
    photos.forEach(p => {
      const fp = path.join(uploadsDir, path.basename(path.dirname(p.file_path)), path.basename(p.file_path));
      if (fs.existsSync(fp)) arc.file(fp, { name: `step_${p.step_number}_${p.step_label||''}${path.extname(p.file_path)}` });
    });
    arc.finalize();
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// PDF Report — returns full HTML page for print
app.get('/api/agent/inspections/:id/report', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id);

    const TL = { pickup: 'PickUp Trailer Pictures', drop: 'Drop Trailer', general: 'General' };
    const inspType = TL[insp.inspection_type] || insp.inspection_type || 'PickUp Trailer Pictures';
    const inspNum = insp.id.replace(/-/g,'').substring(0,8).toUpperCase();
    const submittedDate = insp.submitted_at ? new Date(insp.submitted_at).toLocaleString('en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'N/A';
    const flaggedCount = photos.filter(p => p.flagged).length;

    // Calculate duration
    let duration = 'n/a';
    if (insp.started_at && insp.submitted_at) {
      const ms = new Date(insp.submitted_at) - new Date(insp.started_at);
      const mins = Math.floor(ms/60000), secs = Math.floor((ms%60000)/1000);
      duration = `${mins}m ${secs}s`;
    }

    // Group photos by step
    const byStep = {};
    photos.forEach(p => {
      const key = p.step_number;
      if (!byStep[key]) byStep[key] = { label: p.step_label || `Step ${p.step_number}`, photos: [] };
      byStep[key].photos.push(p);
    });

    // Build photo rows HTML
    const photoSections = Object.entries(byStep).map(([stepNum, step]) => {
      const photoHtml = step.photos.map((p, i) => {
        const fullUrl = `${req.protocol}://${req.get('host')}${p.file_path}`;
        const flagBadge = p.flagged ? `<div style="background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;margin-top:6px;">FLAGGED${p.flag_note ? ': '+p.flag_note : ''}</div>` : '';
        return `<div style="break-inside:avoid;margin-bottom:12px;">
          <img src="${fullUrl}" style="width:100%;max-width:380px;height:auto;border-radius:6px;border:1px solid #e5e7eb;display:block;" onerror="this.style.display='none'">
          ${flagBadge}
        </div>`;
      }).join('');

      return `
        <div style="break-inside:avoid;margin-bottom:0;">
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-bottom:none;padding:10px 14px;font-size:13px;font-weight:700;color:#374151;">
            <span style="color:#6b7280;margin-right:8px;">${stepNum}</span>${step.label}
          </div>
          <div style="border:1px solid #e5e7eb;padding:14px 14px 4px;margin-bottom:16px;">
            <div style="font-size:12px;font-weight:700;color:#6b7280;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
              <span style="font-size:16px;">&#128247;</span> Photos
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:10px;">
              ${photoHtml}
            </div>
          </div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Inspection Report #${inspNum}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 14px; color: #111827; background: #fff; padding: 30px; max-width: 900px; margin: 0 auto; }
  @media print {
    body { padding: 10px; }
    .no-print { display: none !important; }
    @page { margin: 15mm; }
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .header h1 { font-size: 32px; font-weight: 900; color: #111827; }
  .logo-area { text-align: right; }
  .logo-area img { height: 36px; }
  .logo-text { font-size: 22px; font-weight: 900; color: #4f6ef7; }
  .summary-bar { display: flex; align-items: center; gap: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .summary-bar .insp-id { font-weight: 900; color: #111827; }
  .summary-bar span { font-size: 13px; color: #6b7280; }
  .summary-bar strong { color: #111827; }
  .passed-badge { background: #10b981; color: white; font-size: 13px; font-weight: 800; padding: 6px 14px; border-radius: 6px; margin-left: auto; }
  .flagged-badge { background: #ef4444; color: white; font-size: 13px; font-weight: 800; padding: 6px 14px; border-radius: 6px; margin-left: auto; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .info-table td { padding: 10px 14px; border: 1px solid #e5e7eb; vertical-align: top; }
  .info-table .lbl { font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 3px; }
  .info-table .val { font-size: 14px; font-weight: 800; color: #111827; }
  .defects-bar { display: flex; gap: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; }
  .defect-item { font-size: 13px; color: #6b7280; }
  .defect-item strong { font-size: 15px; color: #111827; display: block; }
  .section-title { font-size: 18px; font-weight: 900; margin: 24px 0 14px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #4f6ef7; color: white; border: none; padding: 14px 24px; border-radius: 10px; font-size: 15px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 16px rgba(79,110,247,0.35); z-index: 100; display: flex; align-items: center; gap: 8px; }
  .print-btn:hover { background: #3a57e8; }
  .sig-row { display: flex; gap: 20px; margin-top: 30px; }
  .sig-box { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
  .sig-lbl { font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; margin-bottom: 40px; }
  .sig-line { border-top: 1px solid #d1d5db; padding-top: 6px; font-size: 12px; color: #6b7280; }
</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">&#128438; Print / Save PDF</button>

<div class="header">
  <h1>Inspection Report</h1>
  <div class="logo-area">
    <div class="logo-text">Kurtex</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:2px;">by Rekka Software</div>
  </div>
</div>

<div class="summary-bar">
  <span>Inspection <strong class="insp-id">#${inspNum}</strong></span>
  <span>Inspection Cards: <strong>${Object.keys(byStep).length}</strong></span>
  <span>Inspected Items: <strong>${Object.keys(byStep).length}</strong></span>
  <span>Reported as: <strong>${flaggedCount > 0 ? 'FLAGGED' : 'PASSED'}</strong></span>
  <span class="${flaggedCount > 0 ? 'flagged-badge' : 'passed-badge'}">${flaggedCount > 0 ? '⚑ '+flaggedCount+' FLAG'+(flaggedCount>1?'S':'') : '&#10003;'}</span>
</div>

<table class="info-table">
  <tr>
    <td style="width:50%">
      <span class="lbl">Form</span>
      <span class="val">${inspType}</span>
    </td>
    <td>
      <span class="lbl">Inspection Date (Local time)</span>
      <span class="val">${submittedDate}</span>
    </td>
    <td>
      <span class="lbl">Inspection Duration</span>
      <span class="val">${duration}</span>
    </td>
  </tr>
  <tr>
    <td>
      <span class="lbl">Company</span>
      <span class="val">Kurtex Logistics Inc</span>
    </td>
    <td>
      <span class="lbl">Inspected by</span>
      <span class="val">${insp.driver_name || 'N/A'}</span>
    </td>
    <td>
      <span class="lbl">Team</span>
      <span class="val">${insp.truck_model || 'N/A'}</span>
    </td>
  </tr>
  <tr>
    <td>
      <span class="lbl">Asset Name</span>
      <span class="val">${insp.asset_number || insp.truck_number || 'N/A'}</span>
    </td>
    <td>
      <span class="lbl">Year</span>
      <span class="val">${insp.asset_year || 'N/A'}</span>
    </td>
    <td>
      <span class="lbl">Make &amp; Model</span>
      <span class="val">${[insp.asset_make, insp.asset_model].filter(Boolean).join(' ') || 'N/A'}</span>
    </td>
  </tr>
  <tr>
    <td>
      <span class="lbl">VIN</span>
      <span class="val">${insp.asset_vin || 'N/A'}</span>
    </td>
    <td>
      <span class="lbl">License Plate</span>
      <span class="val">${insp.asset_license_plate || 'N/A'}</span>
    </td>
    <td>
      <span class="lbl">Inspection GPS Location</span>
      <span class="val">${insp.latitude ? `${parseFloat(insp.latitude).toFixed(6)} ${parseFloat(insp.longitude).toFixed(6)}` : 'N/A'}</span>
    </td>
  </tr>
  ${insp.notes ? `<tr><td colspan="3"><span class="lbl">Notes</span><span class="val" style="font-weight:600;color:#374151;">${insp.notes}</span></td></tr>` : ''}
</table>

<div class="defects-bar">
  <div class="defect-item"><strong style="color:${flaggedCount>0?'#ef4444':'#111827'}">${flaggedCount}</strong>Total Flagged</div>
  <div class="defect-item"><strong>${photos.length}</strong>Total Photos</div>
  <div class="defect-item"><strong>${Object.keys(byStep).length}</strong>Steps Completed</div>
  <div class="defect-item"><strong>${insp.truck_number || 'N/A'}</strong>Truck #</div>
</div>

<div class="section-title">Photos</div>
${photoSections}

<div class="sig-row">
  <div class="sig-box">
    <div class="sig-lbl">Reporting Operator's Signature</div>
    <div class="sig-line">n/a</div>
  </div>
  <div class="sig-box">
    <div class="sig-lbl">Reviewing Operator's Signature</div>
    <div class="sig-line">n/a</div>
  </div>
</div>

<div style="margin-top:20px;padding:12px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;font-weight:700;color:#15803d;">
  Condition of the above asset is <strong>${flaggedCount > 0 ? 'requires attention' : 'satisfactory'}</strong>
</div>

<div style="margin-top:30px;text-align:center;font-size:11px;color:#9ca3af;">
  Generated by Kurtex Fleet Inspection System · Rekka Software · ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}
</div>

</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) { console.error('PDF report error:', e.message); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/agent/inspections', agent, async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC LIMIT 100`).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/agent/stats', agent, async (req, res) => {
  try {
    const totalDrivers     = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role='driver' AND active=1").get();
    const totalDispatchers = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role='agent' AND active=1").get();
    const totalInspections = await db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted'").get();
    const todayInspections = await db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted' AND DATE(submitted_at)=CURRENT_DATE").get();
    const totalPhotos      = await db.prepare("SELECT COUNT(*) as c FROM inspection_photos").get();
    res.json({
      totalDrivers: parseInt(totalDrivers?.c||0), totalDispatchers: parseInt(totalDispatchers?.c||0),
      totalInspections: parseInt(totalInspections?.c||0), todayInspections: parseInt(todayInspections?.c||0),
      totalPhotos: parseInt(totalPhotos?.c||0)
    });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Admin – Users ─────────────────────────────────────────────────────────────
app.get('/api/admin/users', admin, async (req, res) => {
  try {
    const role = req.query.role;
    const rows = role
      ? await db.prepare("SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role=? AND role!='superadmin' ORDER BY full_name").all(role)
      : await db.prepare("SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role!='superadmin' ORDER BY role,full_name").all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/users', admin, async (req, res) => {
  try {
    const { username, email, password, full_name, role, truck_model, truck_number } = req.body;
    if (!full_name || !role || !username || !password) return res.status(400).json({ error: 'Name, username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (await db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Username already taken' });
    if (email && await db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already in use' });
    await db.prepare('INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES (?,?,?,?,?,?,?)')
      .run(username, email||null, bcrypt.hashSync(password,10), full_name, role, truck_model||'', truck_number||'');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const { full_name, username, email, password, truck_model, truck_number, active } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot edit superadmin' });
    if (username && username !== user.username && await db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username, req.params.id)) return res.status(409).json({ error: 'Username taken' });
    if (email !== undefined && email !== user.email && await db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, req.params.id)) return res.status(409).json({ error: 'Email in use' });
    if (full_name) await db.prepare('UPDATE users SET full_name=? WHERE id=?').run(full_name, req.params.id);
    if (username) await db.prepare('UPDATE users SET username=? WHERE id=?').run(username, req.params.id);
    if (email !== undefined) await db.prepare('UPDATE users SET email=? WHERE id=?').run(email||null, req.params.id);
    if (truck_model !== undefined) await db.prepare('UPDATE users SET truck_model=? WHERE id=?').run(truck_model, req.params.id);
    if (truck_number !== undefined) await db.prepare('UPDATE users SET truck_number=? WHERE id=?').run(truck_number, req.params.id);
    if (active !== undefined) await db.prepare('UPDATE users SET active=? WHERE id=?').run(active?1:0, req.params.id);
    if (password && password.length >= 6) await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,10), req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot delete superadmin' });
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.params.id);
    await db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Admin – Steps ─────────────────────────────────────────────────────────────
app.get('/api/admin/steps', agent, async (req, res) => {
  try {
    const steps = await db.prepare('SELECT * FROM inspection_steps ORDER BY inspection_type,step_number').all();
    res.json(steps);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/steps', admin, async (req, res) => {
  try {
    const { label, instruction, inspection_type } = req.body;
    if (!label || !instruction) return res.status(400).json({ error: 'Required' });
    const type = inspection_type || 'pickup';
    const max = await db.prepare('SELECT MAX(step_number) as m FROM inspection_steps WHERE inspection_type=?').get(type);
    const nextStep = (max?.m||0) + 1;
    await db.prepare('INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES (?,?,?,?)').run(type, nextStep, label, instruction);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/admin/steps/:id', admin, async (req, res) => {
  try {
    const { active, label, instruction } = req.body;
    if (active !== undefined) await db.prepare('UPDATE inspection_steps SET active=? WHERE id=?').run(active?1:0, req.params.id);
    if (label) await db.prepare('UPDATE inspection_steps SET label=? WHERE id=?').run(label, req.params.id);
    if (instruction) await db.prepare('UPDATE inspection_steps SET instruction=? WHERE id=?').run(instruction, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/steps/:id', admin, async (req, res) => {
  try {
    const step = await db.prepare('SELECT * FROM inspection_steps WHERE id=?').get(req.params.id);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    await db.prepare('DELETE FROM inspection_steps WHERE id=?').run(req.params.id);
    const remaining = await db.prepare('SELECT id FROM inspection_steps WHERE inspection_type=? ORDER BY step_number ASC').all(step.inspection_type);
    for (let i = 0; i < remaining.length; i++) {
      await db.prepare('UPDATE inspection_steps SET step_number=? WHERE id=?').run(i+1, remaining[i].id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.listen(PORT, () => console.log(`Kurtex by Rekka Software - Server running on port ${PORT}`));
