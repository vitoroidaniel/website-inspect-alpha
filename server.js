const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const inspId = req.params.inspectionId || 'temp';
    const dir = path.join(uploadsDir, inspId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `step_${req.params.step}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fleet-inspect-v2-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const requireAuth   = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };
const requireAgent  = (req, res, next) => { if (!req.session.user || !['agent','superadmin'].includes(req.session.user.role)) return res.status(403).json({ error: 'Access denied' }); next(); };
const requireAdmin  = (req, res, next) => { if (!req.session.user || req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' }); next(); };
const requireDriver = (req, res, next) => { if (!req.session.user || req.session.user.role !== 'driver') return res.status(403).json({ error: 'Access denied' }); next(); };

// ── PAGES ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'driver') return res.redirect('/driver/inspect');
  return res.redirect('/agent/dashboard');
});
app.get('/login',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/driver/inspect',   requireAuth, (req, res) => { if (req.session.user.role !== 'driver') return res.redirect('/agent/dashboard'); res.sendFile(path.join(__dirname, 'public', 'driver.html')); });
app.get('/agent/dashboard',  requireAuth, (req, res) => { if (req.session.user.role === 'driver') return res.redirect('/driver/inspect'); res.sendFile(path.join(__dirname, 'public', 'agent.html')); });

// ── AUTH API ─────────────────────────────────────────────────────────────────

// Agents/Admin: username + password login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND role != ?').get(username, 'driver');
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role, name: user.full_name };
  res.json({ role: user.role, name: user.full_name });
});

// Drivers: get list of active drivers (for picker)
app.get('/api/drivers/list', (req, res) => {
  const drivers = db.prepare("SELECT id, full_name, truck_model, truck_number FROM users WHERE role='driver' AND active=1 ORDER BY full_name").all();
  res.json(drivers);
});

// Drivers: PIN login
app.post('/api/driver/login', (req, res) => {
  const { driverId, pin } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND active=1").get(driverId);
  if (!user || user.driver_pin !== String(pin)) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  req.session.user = { id: user.id, username: user.username, role: 'driver', name: user.full_name, truck_model: user.truck_model, truck_number: user.truck_number };
  res.json({ ok: true, name: user.full_name });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));

// Inspection steps
app.get('/api/inspection-steps', requireAuth, (req, res) => {
  const steps = db.prepare('SELECT * FROM inspection_steps WHERE active=1 ORDER BY step_number').all();
  res.json(steps);
});

// ── DRIVER API ───────────────────────────────────────────────────────────────
app.post('/api/inspections/start', requireDriver, (req, res) => {
  const id = uuidv4();
  const u = req.session.user;
  db.prepare(`INSERT INTO inspections (id, driver_id, driver_name, truck_model, truck_number, status, started_at) VALUES (?,?,?,?,?,'in_progress',datetime('now'))`).run(id, u.id, u.name, u.truck_model || 'N/A', u.truck_number || '');
  res.json({ inspectionId: id });
});

app.post('/api/inspections/:inspectionId/step/:step/photo', requireDriver, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { inspectionId, step } = req.params;
    const { latitude, longitude, stepLabel } = req.body;
    const insp = db.prepare('SELECT * FROM inspections WHERE id=? AND driver_id=?').get(inspectionId, req.session.user.id);
    if (!insp) return res.status(404).json({ error: 'Inspection not found' });
    const photoPath = `/uploads/${inspectionId}/${req.file.filename}`;
    db.prepare(`INSERT OR REPLACE INTO inspection_photos (inspection_id, step_number, step_label, file_path, latitude, longitude, taken_at) VALUES (?,?,?,?,?,?,datetime('now'))`).run(inspectionId, parseInt(step), stepLabel || null, photoPath, latitude || null, longitude || null);
    res.json({ ok: true, path: photoPath });
  });
});

app.post('/api/inspections/:inspectionId/submit', requireDriver, (req, res) => {
  const { inspectionId } = req.params;
  const { latitude, longitude, notes } = req.body;
  const insp = db.prepare('SELECT * FROM inspections WHERE id=? AND driver_id=?').get(inspectionId, req.session.user.id);
  if (!insp) return res.status(404).json({ error: 'Inspection not found' });
  const photos = db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=?').all(inspectionId);
  if (!photos.length) return res.status(400).json({ error: 'No photos uploaded' });
  const loc = photos.find(p => p.latitude);
  db.prepare(`UPDATE inspections SET status='submitted', submitted_at=datetime('now'), latitude=?, longitude=?, notes=? WHERE id=?`).run(
    latitude || (loc ? loc.latitude : null), longitude || (loc ? loc.longitude : null), notes || '', inspectionId
  );
  res.json({ ok: true });
});

app.get('/api/driver/inspections', requireDriver, (req, res) => {
  const rows = db.prepare(`SELECT i.*, COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? GROUP BY i.id ORDER BY i.started_at DESC LIMIT 10`).all(req.session.user.id);
  res.json(rows);
});

// ── AGENT API ────────────────────────────────────────────────────────────────
app.get('/api/agent/drivers', requireAgent, (req, res) => {
  const drivers = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.truck_model, u.truck_number, u.active,
      COUNT(i.id) as total_inspections,
      MAX(i.submitted_at) as last_inspection,
      SUM(CASE WHEN i.status='submitted' THEN 1 ELSE 0 END) as submitted_count
    FROM users u
    LEFT JOIN inspections i ON i.driver_id=u.id
    WHERE u.role='driver'
    GROUP BY u.id ORDER BY u.full_name
  `).all();
  res.json(drivers);
});

app.get('/api/agent/drivers/:driverId/inspections', requireAgent, (req, res) => {
  const rows = db.prepare(`SELECT i.*, COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? AND i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC`).all(req.params.driverId);
  res.json(rows);
});

app.get('/api/agent/inspections/:inspectionId', requireAgent, (req, res) => {
  const insp = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.inspectionId);
  if (!insp) return res.status(404).json({ error: 'Not found' });
  const photos = db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.inspectionId);
  res.json({ ...insp, photos });
});

app.get('/api/agent/inspections/:inspectionId/download', requireAgent, (req, res) => {
  const insp = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.inspectionId);
  if (!insp) return res.status(404).json({ error: 'Not found' });
  const photos = db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.inspectionId);
  const safeName = (insp.driver_name || 'driver').replace(/[^a-z0-9]/gi, '_');
  const date = (insp.submitted_at || '').split('T')[0] || 'unknown';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="inspection_${safeName}_${date}.zip"`);
  const archive = archiver('zip');
  archive.pipe(res);
  photos.forEach(p => {
    const fp = path.join(uploadsDir, path.basename(path.dirname(p.file_path)), path.basename(p.file_path));
    if (fs.existsSync(fp)) archive.file(fp, { name: `step_${p.step_number}_${p.step_label || ''}${path.extname(p.file_path)}` });
  });
  archive.finalize();
});

app.get('/api/agent/inspections', requireAgent, (req, res) => {
  const rows = db.prepare(`SELECT i.*, COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC LIMIT 100`).all();
  res.json(rows);
});

app.get('/api/agent/stats', requireAgent, (req, res) => {
  res.json({
    totalDrivers:      db.prepare("SELECT COUNT(*) as c FROM users WHERE role='driver' AND active=1").get().c,
    totalInspections:  db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted'").get().c,
    todayInspections:  db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted' AND date(submitted_at)=date('now')").get().c,
    totalPhotos:       db.prepare("SELECT COUNT(*) as c FROM inspection_photos").get().c,
  });
});

// ── ADMIN API ────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, full_name, role, truck_model, truck_number, driver_pin, active FROM users WHERE role!='superadmin' ORDER BY role, full_name").all();
  res.json(users);
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, full_name, role, truck_model, truck_number, driver_pin } = req.body;
  if (!full_name || !role) return res.status(400).json({ error: 'Name and role required' });
  if (role === 'driver') {
    // Drivers don't need username/password, just PIN
    const pin = String(driver_pin || '').trim();
    if (!pin || pin.length < 4) return res.status(400).json({ error: 'Driver PIN must be at least 4 digits' });
    const uname = username || ('d_' + full_name.toLowerCase().replace(/\s+/g,'_') + '_' + Date.now());
    const fakeHash = bcrypt.hashSync(uuidv4(), 10); // drivers log in via PIN, not password
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(uname);
    if (existing) return res.status(409).json({ error: 'Username taken' });
    db.prepare('INSERT INTO users (username, password_hash, full_name, role, truck_model, truck_number, driver_pin) VALUES (?,?,?,?,?,?,?)').run(uname, fakeHash, full_name, 'driver', truck_model || '', truck_number || '', pin);
  } else {
    if (!username || !password) return res.status(400).json({ error: 'Username and password required for agents' });
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (existing) return res.status(409).json({ error: 'Username taken' });
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)').run(username, hash, full_name, 'agent');
  }
  res.json({ ok: true });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { active, driver_pin, truck_model, truck_number, full_name } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  if (driver_pin)    db.prepare('UPDATE users SET driver_pin=? WHERE id=?').run(driver_pin, req.params.id);
  if (truck_model)   db.prepare('UPDATE users SET truck_model=? WHERE id=?').run(truck_model, req.params.id);
  if (truck_number)  db.prepare('UPDATE users SET truck_number=? WHERE id=?').run(truck_number, req.params.id);
  if (full_name)     db.prepare('UPDATE users SET full_name=? WHERE id=?').run(full_name, req.params.id);
  res.json({ ok: true });
});

// Inspection step management
app.get('/api/admin/steps', requireAgent, (req, res) => {
  res.json(db.prepare('SELECT * FROM inspection_steps ORDER BY step_number').all());
});
app.post('/api/admin/steps', requireAdmin, (req, res) => {
  const { label, instruction } = req.body;
  if (!label || !instruction) return res.status(400).json({ error: 'Label and instruction required' });
  const max = db.prepare('SELECT MAX(step_number) as m FROM inspection_steps').get().m || 0;
  db.prepare('INSERT INTO inspection_steps (step_number, label, instruction) VALUES (?,?,?)').run(max + 1, label, instruction);
  res.json({ ok: true });
});
app.patch('/api/admin/steps/:id', requireAdmin, (req, res) => {
  const { active, label, instruction } = req.body;
  if (active !== undefined) db.prepare('UPDATE inspection_steps SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  if (label)       db.prepare('UPDATE inspection_steps SET label=? WHERE id=?').run(label, req.params.id);
  if (instruction) db.prepare('UPDATE inspection_steps SET instruction=? WHERE id=?').run(instruction, req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`FleetInspect v2 running on port ${PORT}`));
