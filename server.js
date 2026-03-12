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

// Use Railway persistent disk path for uploads (or local for development)
const uploadsDir = process.env.UPLOADS_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage configuration
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
const agent  = (req, res, next) => req.session.user && ['agent', 'superadmin'].includes(req.session.user.role) ? next() : res.status(403).json({ error: 'Access denied' });
const admin  = (req, res, next) => req.session.user && req.session.user.role === 'superadmin' ? next() : res.status(403).json({ error: 'Admin only' });
const driver = (req, res, next) => req.session.user && req.session.user.role === 'driver' ? next() : res.status(403).json({ error: 'Access denied' });

// Pages
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return req.session.user.role === 'driver' ? res.redirect('/driver/inspect') : res.redirect('/agent/dashboard');
});
app.get('/login',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/driver/inspect',  auth, (req, res) => req.session.user.role === 'driver' ? res.sendFile(path.join(__dirname, 'public', 'driver.html')) : res.redirect('/agent/dashboard'));
app.get('/agent/dashboard', auth, (req, res) => req.session.user.role !== 'driver' ? res.sendFile(path.join(__dirname, 'public', 'agent.html')) : res.redirect('/driver/inspect'));

// Auth
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, keepSignedIn } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE (username=? OR email=?) AND active=1').get(username, username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.cookie.maxAge = keepSignedIn ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
    req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role, name: user.full_name, truck_model: user.truck_model, truck_number: user.truck_number };
    res.json({ role: user.role, name: user.full_name });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// WebAuthn
app.post('/api/auth/webauthn/register-options', auth, (req, res) => {
  const user = req.session.user;
  const challenge = uuidv4().replace(/-/g, '');
  req.session.webauthnChallenge = challenge;
  res.json({
    challenge,
    rp: { name: 'Kurtex', id: req.hostname },
    user: { id: Buffer.from(String(user.id)).toString('base64'), name: user.username, displayName: user.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged', authenticatorAttachment: 'platform' },
    timeout: 60000
  });
});

app.post('/api/auth/webauthn/register', auth, async (req, res) => {
  try {
    const { credentialId, publicKey, transports } = req.body;
    if (!credentialId) return res.status(400).json({ error: 'Missing credential' });
    // PostgreSQL upsert on credential_id conflict
    await db.prepare(
      'INSERT INTO webauthn_credentials (user_id, credential_id, public_key, transports) VALUES (?,?,?,?) ON CONFLICT (credential_id) DO UPDATE SET public_key=EXCLUDED.public_key, transports=EXCLUDED.transports'
    ).run(req.session.user.id, credentialId, publicKey || '', JSON.stringify(transports || []));
    res.json({ ok: true });
  } catch (e) {
    console.error('WebAuthn register error:', e.message);
    res.status(500).json({ error: 'Failed to register credential' });
  }
});

app.post('/api/auth/webauthn/remove-credential', auth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.session.user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Remove credential error:', e.message);
    res.status(500).json({ error: 'Failed to remove credential' });
  }
});

app.post('/api/auth/webauthn/login-options', async (req, res) => {
  try {
    const challenge = uuidv4().replace(/-/g, '');
    req.session.webauthnChallenge = challenge;
    const { username } = req.body;
    let allowCredentials = [];
    if (username) {
      const user = await db.prepare('SELECT * FROM users WHERE (username=? OR email=?) AND active=1').get(username, username);
      if (user) {
        const creds = await db.prepare('SELECT * FROM webauthn_credentials WHERE user_id=?').all(user.id);
        allowCredentials = creds.map(c => ({ type: 'public-key', id: c.credential_id, transports: JSON.parse(c.transports || '[]') }));
      }
    }
    res.json({ challenge, allowCredentials, timeout: 60000, userVerification: 'required', rpId: req.hostname });
  } catch (e) {
    console.error('WebAuthn login-options error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/webauthn/login', async (req, res) => {
  try {
    const { credentialId } = req.body;
    const cred = await db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id=?').get(credentialId);
    if (!cred) return res.status(401).json({ error: 'Biometric not registered' });
    const user = await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(cred.user_id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role, name: user.full_name, truck_model: user.truck_model, truck_number: user.truck_number };
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
  } catch (e) {
    res.json({ registered: false });
  }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.session.user));

app.get('/api/inspection-steps', auth, async (req, res) => {
  try {
    const steps = await db.prepare('SELECT * FROM inspection_steps WHERE active=1 AND inspection_type=? ORDER BY step_number').all(req.query.type || 'pickup');
    res.json(steps);
  } catch (e) {
    console.error('Steps error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Driver
app.post('/api/inspections/start', driver, async (req, res) => {
  try {
    const id = uuidv4(), u = req.session.user, type = req.body.inspection_type || 'pickup';
    await db.prepare(
      `INSERT INTO inspections (id,driver_id,driver_name,truck_model,truck_number,inspection_type,status,started_at) VALUES (?,?,?,?,?,?,'in_progress',NOW())`
    ).run(id, u.id, u.name, u.truck_model || 'N/A', u.truck_number || '', type);
    res.json({ inspectionId: id });
  } catch (e) {
    console.error('Start inspection error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
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

      // Compress and resize image using sharp
      const compressedPath = req.file.path.replace(/\.[^.]+$/, '_compressed.jpg');
      await sharp(req.file.path)
        .jpeg({ quality: 70 })
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .toFile(compressedPath);

      fs.unlinkSync(req.file.path);
      fs.renameSync(compressedPath, req.file.path);

      const photoPath = `/uploads/${inspectionId}/${path.basename(req.file.path)}`;

      await db.prepare(
        `INSERT INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,NOW())`
      ).run(inspectionId, parseInt(step), stepLabel || null, photoPath, latitude || null, longitude || null);

      res.json({ ok: true, path: photoPath });
    } catch (e) {
      console.error('Photo upload error:', e.message);
      // Fallback: save without compression
      try {
        const photoPath = `/uploads/${inspectionId}/${req.file.filename}`;
        await db.prepare(
          `INSERT INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,NOW())`
        ).run(inspectionId, parseInt(step), stepLabel || null, photoPath, latitude || null, longitude || null);
        res.json({ ok: true, path: photoPath });
      } catch (e2) {
        res.status(500).json({ error: 'Failed to save photo' });
      }
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
    await db.prepare(
      `UPDATE inspections SET status='submitted',submitted_at=NOW(),latitude=?,longitude=?,notes=? WHERE id=?`
    ).run(latitude || (loc ? loc.latitude : null), longitude || (loc ? loc.longitude : null), notes || '', inspectionId);

    res.json({ ok: true });
  } catch (e) {
    console.error('Submit error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/driver/inspections', driver, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? GROUP BY i.id ORDER BY i.started_at DESC LIMIT 10`
    ).all(req.session.user.id);
    res.json(rows);
  } catch (e) {
    console.error('Driver inspections error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Agent
app.get('/api/agent/drivers', agent, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT u.id,u.full_name,u.username,u.email,u.truck_model,u.truck_number,u.active,COUNT(i.id) as total_inspections,MAX(i.submitted_at) as last_inspection,SUM(CASE WHEN i.status='submitted' THEN 1 ELSE 0 END) as submitted_count FROM users u LEFT JOIN inspections i ON i.driver_id=u.id WHERE u.role='driver' GROUP BY u.id ORDER BY u.full_name`
    ).all();
    res.json(rows);
  } catch (e) {
    console.error('Agent drivers error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/agent/drivers/:id/inspections', agent, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? AND i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC`
    ).all(req.params.id);
    res.json(rows);
  } catch (e) {
    console.error('Driver inspections error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/agent/inspections/:id', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id);
    res.json({ ...insp, photos });
  } catch (e) {
    console.error('Inspection detail error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/agent/inspections/:id/download', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="inspection_${(insp.driver_name || '').replace(/[^a-z0-9]/gi, '_')}_${(insp.submitted_at || '').toString().split('T')[0]}.zip"`);

    const arc = archiver('zip');
    arc.pipe(res);
    photos.forEach(p => {
      const fp = path.join(uploadsDir, path.basename(path.dirname(p.file_path)), path.basename(p.file_path));
      if (fs.existsSync(fp)) arc.file(fp, { name: `step_${p.step_number}_${p.step_label || ''}${path.extname(p.file_path)}` });
    });
    arc.finalize();
  } catch (e) {
    console.error('Download error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/agent/inspections', agent, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC LIMIT 100`
    ).all();
    res.json(rows);
  } catch (e) {
    console.error('Agent inspections error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/agent/stats', agent, async (req, res) => {
  try {
    const totalDrivers     = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role='driver' AND active=1").get();
    const totalDispatchers = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role='agent' AND active=1").get();
    const totalInspections = await db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted'").get();
    const todayInspections = await db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted' AND DATE(submitted_at)=CURRENT_DATE").get();
    const totalPhotos      = await db.prepare("SELECT COUNT(*) as c FROM inspection_photos").get();
    res.json({
      totalDrivers:     parseInt(totalDrivers?.c || 0),
      totalDispatchers: parseInt(totalDispatchers?.c || 0),
      totalInspections: parseInt(totalInspections?.c || 0),
      todayInspections: parseInt(todayInspections?.c || 0),
      totalPhotos:      parseInt(totalPhotos?.c || 0),
    });
  } catch (e) {
    console.error('Stats error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin — full CRUD
app.get('/api/admin/users', admin, async (req, res) => {
  try {
    const role = req.query.role;
    let rows;
    if (role) {
      rows = await db.prepare(
        "SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role=? AND role!='superadmin' ORDER BY full_name"
      ).all(role);
    } else {
      rows = await db.prepare(
        "SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role!='superadmin' ORDER BY role,full_name"
      ).all();
    }
    res.json(rows);
  } catch (e) {
    console.error('Admin users error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/users', admin, async (req, res) => {
  try {
    const { username, email, password, full_name, role, truck_model, truck_number } = req.body;
    if (!full_name || !role || !username || !password) return res.status(400).json({ error: 'Name, username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (await db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Username already taken' });
    if (email && await db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already in use' });
    await db.prepare('INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES (?,?,?,?,?,?,?)')
      .run(username, email || null, bcrypt.hashSync(password, 10), full_name, role, truck_model || '', truck_number || '');
    res.json({ ok: true });
  } catch (e) {
    console.error('Create user error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const { full_name, username, email, password, truck_model, truck_number, active } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot edit superadmin' });
    if (username && username !== user.username && await db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username, req.params.id)) return res.status(409).json({ error: 'Username taken' });
    if (email !== undefined && email !== user.email && await db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, req.params.id)) return res.status(409).json({ error: 'Email in use' });
    if (full_name)            await db.prepare('UPDATE users SET full_name=? WHERE id=?').run(full_name, req.params.id);
    if (username)             await db.prepare('UPDATE users SET username=? WHERE id=?').run(username, req.params.id);
    if (email !== undefined)  await db.prepare('UPDATE users SET email=? WHERE id=?').run(email || null, req.params.id);
    if (truck_model !== undefined) await db.prepare('UPDATE users SET truck_model=? WHERE id=?').run(truck_model, req.params.id);
    if (truck_number !== undefined) await db.prepare('UPDATE users SET truck_number=? WHERE id=?').run(truck_number, req.params.id);
    if (active !== undefined) await db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
    if (password && password.length >= 6) await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Update user error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot delete superadmin' });
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.params.id);
    await db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete user error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/steps', agent, async (req, res) => {
  try {
    const steps = await db.prepare('SELECT * FROM inspection_steps ORDER BY inspection_type,step_number').all();
    res.json(steps);
  } catch (e) {
    console.error('Admin steps error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/steps', admin, async (req, res) => {
  try {
    const { label, instruction, inspection_type } = req.body;
    if (!label || !instruction) return res.status(400).json({ error: 'Required' });
    const type = inspection_type || 'pickup';
    const max = await db.prepare('SELECT MAX(step_number) as m FROM inspection_steps WHERE inspection_type=?').get(type);
    const nextStep = (max?.m || 0) + 1;
    await db.prepare('INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES (?,?,?,?)').run(type, nextStep, label, instruction);
    res.json({ ok: true });
  } catch (e) {
    console.error('Create step error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/admin/steps/:id', admin, async (req, res) => {
  try {
    const { active, label, instruction } = req.body;
    if (active !== undefined) await db.prepare('UPDATE inspection_steps SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
    if (label)       await db.prepare('UPDATE inspection_steps SET label=? WHERE id=?').run(label, req.params.id);
    if (instruction) await db.prepare('UPDATE inspection_steps SET instruction=? WHERE id=?').run(instruction, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Update step error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => console.log(`Kurtex by Rekka Software - Server running on port ${PORT}`));
