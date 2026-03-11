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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.params.inspectionId || 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `step_${req.params.step}_${Date.now()}${path.extname(file.originalname)||'.jpg'}`)
});
const upload = multer({ storage, limits:{fileSize:25*1024*1024}, fileFilter:(req,file,cb)=>file.mimetype.startsWith('image/')?cb(null,true):cb(new Error('Images only')) });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fleetinspect-secret-2025',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 30*24*60*60*1000 }
}));

const auth   = (req,res,next) => req.session.user ? next() : res.redirect('/login');
const agent  = (req,res,next) => req.session.user && ['agent','superadmin'].includes(req.session.user.role) ? next() : res.status(403).json({error:'Access denied'});
const admin  = (req,res,next) => req.session.user && req.session.user.role==='superadmin' ? next() : res.status(403).json({error:'Admin only'});
const driver = (req,res,next) => req.session.user && req.session.user.role==='driver' ? next() : res.status(403).json({error:'Access denied'});

// Pages
app.get('/', (req,res) => { if(!req.session.user) return res.redirect('/login'); return req.session.user.role==='driver' ? res.redirect('/driver/inspect') : res.redirect('/agent/dashboard'); });
app.get('/login',           (req,res) => res.sendFile(path.join(__dirname,'public','login.html')));
app.get('/driver/inspect',  auth, (req,res) => req.session.user.role==='driver' ? res.sendFile(path.join(__dirname,'public','driver.html')) : res.redirect('/agent/dashboard'));
app.get('/agent/dashboard', auth, (req,res) => req.session.user.role!=='driver' ? res.sendFile(path.join(__dirname,'public','agent.html')) : res.redirect('/driver/inspect'));

// Auth
app.post('/api/login', (req,res) => {
  const { username, password, keepSignedIn } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE (username=? OR email=?) AND active=1').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({error:'Invalid credentials'});
  req.session.cookie.maxAge = keepSignedIn ? 30*24*60*60*1000 : 8*60*60*1000;
  req.session.user = { id:user.id, username:user.username, email:user.email, role:user.role, name:user.full_name, truck_model:user.truck_model, truck_number:user.truck_number };
  res.json({ role:user.role, name:user.full_name });
});

// WebAuthn credential storage (simple in-db store)
app.post('/api/auth/webauthn/register-options', auth, (req,res) => {
  const user = req.session.user;
  const challenge = uuidv4().replace(/-/g,'');
  req.session.webauthnChallenge = challenge;
  res.json({
    challenge,
    rp: { name:'FleetInspect', id: req.hostname },
    user: { id: Buffer.from(String(user.id)).toString('base64'), name: user.username, displayName: user.name },
    pubKeyCredParams: [{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
    authenticatorSelection: { userVerification:'required' },
    timeout: 60000
  });
});

app.post('/api/auth/webauthn/register', auth, (req,res) => {
  const { credentialId, publicKey, transports } = req.body;
  if (!credentialId) return res.status(400).json({error:'Missing credential'});
  db.prepare('INSERT OR REPLACE INTO webauthn_credentials (user_id, credential_id, public_key, transports) VALUES (?,?,?,?)').run(req.session.user.id, credentialId, publicKey||'', JSON.stringify(transports||[]));
  res.json({ok:true});
});

app.post('/api/auth/webauthn/login-options', (req,res) => {
  const challenge = uuidv4().replace(/-/g,'');
  req.session.webauthnChallenge = challenge;
  const { username } = req.body;
  let allowCredentials = [];
  if (username) {
    const user = db.prepare('SELECT * FROM users WHERE (username=? OR email=?) AND active=1').get(username,username);
    if (user) {
      const creds = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id=?').all(user.id);
      allowCredentials = creds.map(c=>({type:'public-key',id:c.credential_id,transports:JSON.parse(c.transports||'[]')}));
    }
  }
  res.json({ challenge, allowCredentials, timeout:60000, userVerification:'required', rpId: req.hostname });
});

app.post('/api/auth/webauthn/login', (req,res) => {
  const { credentialId, username } = req.body;
  const cred = db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id=?').get(credentialId);
  if (!cred) return res.status(401).json({error:'Biometric not registered'});
  const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(cred.user_id);
  if (!user) return res.status(401).json({error:'User not found'});
  req.session.cookie.maxAge = 30*24*60*60*1000;
  req.session.user = { id:user.id, username:user.username, email:user.email, role:user.role, name:user.full_name, truck_model:user.truck_model, truck_number:user.truck_number };
  res.json({ role:user.role, name:user.full_name });
});

app.get('/api/auth/webauthn/has-credential', auth, (req,res) => {
  const cred = db.prepare('SELECT id FROM webauthn_credentials WHERE user_id=?').get(req.session.user.id);
  res.json({ registered: !!cred });
});

app.post('/api/logout', (req,res) => { req.session.destroy(); res.json({ok:true}); });
app.get('/api/me', auth, (req,res) => res.json(req.session.user));

app.get('/api/inspection-steps', auth, (req,res) => {
  res.json(db.prepare('SELECT * FROM inspection_steps WHERE active=1 AND inspection_type=? ORDER BY step_number').all(req.query.type||'pickup'));
});

// Driver
app.post('/api/inspections/start', driver, (req,res) => {
  const id = uuidv4(), u = req.session.user, type = req.body.inspection_type||'pickup';
  db.prepare(`INSERT INTO inspections (id,driver_id,driver_name,truck_model,truck_number,inspection_type,status,started_at) VALUES (?,?,?,?,?,?,'in_progress',datetime('now'))`).run(id,u.id,u.name,u.truck_model||'N/A',u.truck_number||'',type);
  res.json({inspectionId:id});
});

app.post('/api/inspections/:inspectionId/step/:step/photo', driver, (req,res) => {
  upload.single('photo')(req,res,err=>{
    if(err) return res.status(400).json({error:err.message});
    if(!req.file) return res.status(400).json({error:'No file'});
    const {inspectionId,step}=req.params, {latitude,longitude,stepLabel}=req.body;
    if(!db.prepare('SELECT id FROM inspections WHERE id=? AND driver_id=?').get(inspectionId,req.session.user.id)) return res.status(404).json({error:'Not found'});
    const photoPath=`/uploads/${inspectionId}/${req.file.filename}`;
    db.prepare(`INSERT OR REPLACE INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,datetime('now'))`).run(inspectionId,parseInt(step),stepLabel||null,photoPath,latitude||null,longitude||null);
    res.json({ok:true,path:photoPath});
  });
});

app.post('/api/inspections/:inspectionId/submit', driver, (req,res) => {
  const {inspectionId}=req.params, {latitude,longitude,notes}=req.body;
  const insp=db.prepare('SELECT * FROM inspections WHERE id=? AND driver_id=?').get(inspectionId,req.session.user.id);
  if(!insp) return res.status(404).json({error:'Not found'});
  const photos=db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=?').all(inspectionId);
  if(!photos.length) return res.status(400).json({error:'No photos'});
  const loc=photos.find(p=>p.latitude);
  db.prepare(`UPDATE inspections SET status='submitted',submitted_at=datetime('now'),latitude=?,longitude=?,notes=? WHERE id=?`).run(latitude||(loc?loc.latitude:null),longitude||(loc?loc.longitude:null),notes||'',inspectionId);
  res.json({ok:true});
});

app.get('/api/driver/inspections', driver, (req,res) => {
  res.json(db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? GROUP BY i.id ORDER BY i.started_at DESC LIMIT 10`).all(req.session.user.id));
});

// Agent
app.get('/api/agent/drivers', agent, (req,res) => {
  res.json(db.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.truck_model,u.truck_number,u.active,COUNT(i.id) as total_inspections,MAX(i.submitted_at) as last_inspection,SUM(CASE WHEN i.status='submitted' THEN 1 ELSE 0 END) as submitted_count FROM users u LEFT JOIN inspections i ON i.driver_id=u.id WHERE u.role='driver' GROUP BY u.id ORDER BY u.full_name`).all());
});

app.get('/api/agent/drivers/:id/inspections', agent, (req,res) => {
  res.json(db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.driver_id=? AND i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC`).all(req.params.id));
});

app.get('/api/agent/inspections/:id', agent, (req,res) => {
  const insp=db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if(!insp) return res.status(404).json({error:'Not found'});
  res.json({...insp, photos:db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id)});
});

app.get('/api/agent/inspections/:id/download', agent, (req,res) => {
  const insp=db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if(!insp) return res.status(404).json({error:'Not found'});
  const photos=db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number').all(req.params.id);
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition',`attachment; filename="inspection_${(insp.driver_name||'').replace(/[^a-z0-9]/gi,'_')}_${(insp.submitted_at||'').split('T')[0]}.zip"`);
  const arc=archiver('zip'); arc.pipe(res);
  photos.forEach(p=>{ const fp=path.join(uploadsDir,path.basename(path.dirname(p.file_path)),path.basename(p.file_path)); if(fs.existsSync(fp)) arc.file(fp,{name:`step_${p.step_number}_${p.step_label||''}${path.extname(p.file_path)}`}); });
  arc.finalize();
});

app.get('/api/agent/inspections', agent, (req,res) => {
  res.json(db.prepare(`SELECT i.*,COUNT(p.id) as photo_count FROM inspections i LEFT JOIN inspection_photos p ON p.inspection_id=i.id WHERE i.status='submitted' GROUP BY i.id ORDER BY i.submitted_at DESC LIMIT 100`).all());
});

app.get('/api/agent/stats', agent, (req,res) => {
  res.json({
    totalDrivers:     db.prepare("SELECT COUNT(*) as c FROM users WHERE role='driver' AND active=1").get().c,
    totalDispatchers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='agent' AND active=1").get().c,
    totalInspections: db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted'").get().c,
    todayInspections: db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted' AND date(submitted_at)=date('now')").get().c,
    totalPhotos:      db.prepare("SELECT COUNT(*) as c FROM inspection_photos").get().c,
  });
});

// Admin — full CRUD
app.get('/api/admin/users', admin, (req,res) => {
  const role=req.query.role;
  const q = role
    ? "SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role=? AND role!='superadmin' ORDER BY full_name"
    : "SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role!='superadmin' ORDER BY role,full_name";
  res.json(role ? db.prepare(q).all(role) : db.prepare(q).all());
});

app.post('/api/admin/users', admin, (req,res) => {
  const {username,email,password,full_name,role,truck_model,truck_number}=req.body;
  if(!full_name||!role||!username||!password) return res.status(400).json({error:'Name, username and password required'});
  if(password.length<6) return res.status(400).json({error:'Password must be at least 6 characters'});
  if(db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({error:'Username already taken'});
  if(email&&db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({error:'Email already in use'});
  db.prepare('INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES (?,?,?,?,?,?,?)').run(username,email||null,bcrypt.hashSync(password,10),full_name,role,truck_model||'',truck_number||'');
  res.json({ok:true});
});

app.put('/api/admin/users/:id', admin, (req,res) => {
  const {full_name,username,email,password,truck_model,truck_number,active}=req.body;
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!user) return res.status(404).json({error:'Not found'});
  if(user.role==='superadmin') return res.status(403).json({error:'Cannot edit superadmin'});
  if(username&&username!==user.username&&db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username,req.params.id)) return res.status(409).json({error:'Username taken'});
  if(email&&email!==user.email&&db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email,req.params.id)) return res.status(409).json({error:'Email in use'});
  if(full_name)    db.prepare('UPDATE users SET full_name=? WHERE id=?').run(full_name,req.params.id);
  if(username)     db.prepare('UPDATE users SET username=? WHERE id=?').run(username,req.params.id);
  if(email!==undefined) db.prepare('UPDATE users SET email=? WHERE id=?').run(email||null,req.params.id);
  if(truck_model!==undefined) db.prepare('UPDATE users SET truck_model=? WHERE id=?').run(truck_model,req.params.id);
  if(truck_number!==undefined) db.prepare('UPDATE users SET truck_number=? WHERE id=?').run(truck_number,req.params.id);
  if(active!==undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(active?1:0,req.params.id);
  if(password&&password.length>=6) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,10),req.params.id);
  res.json({ok:true});
});

app.delete('/api/admin/users/:id', admin, (req,res) => {
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!user) return res.status(404).json({error:'Not found'});
  if(user.role==='superadmin') return res.status(403).json({error:'Cannot delete superadmin'});
  db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.get('/api/admin/steps', agent, (req,res) => res.json(db.prepare('SELECT * FROM inspection_steps ORDER BY inspection_type,step_number').all()));
app.post('/api/admin/steps', admin, (req,res) => {
  const {label,instruction,inspection_type}=req.body;
  if(!label||!instruction) return res.status(400).json({error:'Required'});
  const type=inspection_type||'pickup';
  const max=db.prepare('SELECT MAX(step_number) as m FROM inspection_steps WHERE inspection_type=?').get(type).m||0;
  db.prepare('INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES (?,?,?,?)').run(type,max+1,label,instruction);
  res.json({ok:true});
});
app.patch('/api/admin/steps/:id', admin, (req,res) => {
  const {active,label,instruction}=req.body;
  if(active!==undefined) db.prepare('UPDATE inspection_steps SET active=? WHERE id=?').run(active?1:0,req.params.id);
  if(label) db.prepare('UPDATE inspection_steps SET label=? WHERE id=?').run(label,req.params.id);
  if(instruction) db.prepare('UPDATE inspection_steps SET instruction=? WHERE id=?').run(instruction,req.params.id);
  res.json({ok:true});
});

app.listen(PORT, ()=>console.log(`FleetInspect v4 on port ${PORT}`));