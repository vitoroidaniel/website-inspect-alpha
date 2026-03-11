const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');

// Ensure the directory exists before opening (needed when Railway volume isn't mounted yet)
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('driver','agent','superadmin')),
    truck_model TEXT,
    truck_number TEXT,
    driver_pin TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    driver_id INTEGER NOT NULL,
    driver_name TEXT NOT NULL,
    truck_model TEXT,
    truck_number TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    latitude REAL,
    longitude REAL,
    notes TEXT,
    started_at DATETIME,
    submitted_at DATETIME,
    FOREIGN KEY(driver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS inspection_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_label TEXT,
    file_path TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    taken_at DATETIME,
    FOREIGN KEY(inspection_id) REFERENCES inspections(id)
  );

  CREATE TABLE IF NOT EXISTS inspection_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_number INTEGER NOT NULL,
    label TEXT NOT NULL,
    instruction TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
`);

// Add new columns if upgrading from old schema
try { db.exec("ALTER TABLE users ADD COLUMN truck_number TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN driver_pin TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE inspections ADD COLUMN truck_number TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inspection_photos ADD COLUMN step_label TEXT"); } catch(e) {}

// Seed default inspection steps
const stepCount = db.prepare('SELECT COUNT(*) as c FROM inspection_steps').get().c;
if (stepCount === 0) {
  const steps = [
    [1, 'Front Exterior',    'Stand 3–4m in front. Capture full front: bumper, headlights, grille, hood.'],
    [2, 'Rear Exterior',     'Move to rear. Capture tail lights, license plate, rear bumper, trailer hitch.'],
    [3, 'Driver Side',       'Photograph full driver side from front to rear — doors, tires, mirrors.'],
    [4, 'Passenger Side',    'Photograph full passenger side from front to rear — doors, tires, steps.'],
    [5, 'Engine Bay',        'Open hood. Photograph full engine bay including fluid levels if visible.'],
    [6, 'Cargo / Trailer',   'Open cargo or trailer door. Capture interior, load securing, and seals.'],
    [7, 'Dashboard',         'Sit in cab. Capture full dashboard: odometer, fuel gauge, warning lights.'],
    [8, 'Tires Close-Up',    'Photograph each tire tread. Any visible damage or wear must be shown.'],
  ];
  const ins = db.prepare('INSERT INTO inspection_steps (step_number, label, instruction) VALUES (?,?,?)');
  steps.forEach(s => ins.run(...s));
}

// Seed default users
const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (count === 0) {
  const adminHash = bcrypt.hashSync('admin123', 10);
  const agent1Hash = bcrypt.hashSync('dispatch123', 10);
  const driver1Hash = bcrypt.hashSync('driver123', 10);
  const driver2Hash = bcrypt.hashSync('driver123', 10);

  db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)').run('admin', adminHash, 'System Admin', 'superadmin');
  db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)').run('dispatch', agent1Hash, 'Sarah Mitchell', 'agent');
  db.prepare('INSERT INTO users (username, password_hash, full_name, role, truck_model, truck_number, driver_pin) VALUES (?,?,?,?,?,?,?)').run('driver1', driver1Hash, 'James Rodriguez', 'driver', 'Freightliner Cascadia 2022', 'TRK-001', '1234');
  db.prepare('INSERT INTO users (username, password_hash, full_name, role, truck_model, truck_number, driver_pin) VALUES (?,?,?,?,?,?,?)').run('driver2', driver2Hash, 'Mike Thompson', 'driver', 'Kenworth T680 2021', 'TRK-002', '5678');

  console.log('Seeded: admin/admin123, dispatch/dispatch123, driver1 PIN:1234, driver2 PIN:5678');
}

module.exports = db;
