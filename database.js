const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
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
    inspection_type TEXT NOT NULL DEFAULT 'pickup',
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
    inspection_type TEXT NOT NULL DEFAULT 'pickup',
    step_number INTEGER NOT NULL,
    label TEXT NOT NULL,
    instruction TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
`);

try { db.exec("ALTER TABLE users ADD COLUMN truck_number TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN driver_pin TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE inspections ADD COLUMN truck_number TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inspections ADD COLUMN inspection_type TEXT NOT NULL DEFAULT 'pickup'"); } catch(e) {}
try { db.exec("ALTER TABLE inspection_photos ADD COLUMN step_label TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inspection_steps ADD COLUMN inspection_type TEXT NOT NULL DEFAULT 'pickup'"); } catch(e) {}

const stepCount = db.prepare('SELECT COUNT(*) as c FROM inspection_steps').get().c;
if (stepCount === 0) {
  const pickupSteps = [
    [1,  'Engine Hours',                     'Photograph the engine hours display clearly. Ensure reading is visible.'],
    [2,  'Trailer Annual Inspection',         'Photograph annual inspection sticker/certificate. Expiration date must be visible.'],
    [3,  'Trailer Registration',              'Photograph the trailer registration document. All text must be legible.'],
    [4,  'Front Driver Side Corner',          'Stand at the front driver-side corner. Capture bumper, corner, and front frame.'],
    [5,  'Driver Side Landing Gear',          'Photograph the driver-side landing gear fully. Show condition and position.'],
    [6,  'Fuel Level',                        'Photograph the fuel gauge or fuel level indicator clearly.'],
    [7,  'Spare Tire',                        'Photograph the spare tire. Show mounting, condition, and tread.'],
    [8,  'Driver Side of Trailer (3 pics)',   'Take at least 3 photos of the full driver side from front to rear.'],
    [9,  'Driver Side Front Axel (3 pics)',   'At least 3 close-up photos of front axel tires on driver side.'],
    [10, 'Driver Side Rear Axel (3 pics)',    'At least 3 close-up photos of rear axel tires on driver side.'],
    [11, 'Back of Trailer + Lights On',       'Capture the full rear of the trailer with all lights illuminated and working.'],
    [12, 'Inside Trailer / Doors',            'Open trailer doors. Photograph the interior, door condition, and seals.'],
    [13, 'License Plate Light',               'Close-up of the license plate and its light. Ensure plate is legible.'],
    [14, 'Passenger Side Rear Axel (3 pics)', 'At least 3 close-up photos of rear axel tires on passenger side.'],
    [15, 'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
    [16, 'Passenger Side of Trailer (3 pics)','Take at least 3 photos of the full passenger side from front to rear.'],
    [17, 'Passenger Side Landing Gear',       'Photograph the passenger-side landing gear fully. Show condition and position.'],
    [18, 'Front Crossmember',                 'Photograph the front crossmember. Show any damage or wear.'],
    [19, 'Passenger Side Front Corner',       'Stand at the passenger-side front corner. Capture bumper, corner, and frame.'],
    [20, 'Front of Trailer',                  'Photograph the full front face of the trailer.'],
    [21, 'Engine Compartment',                'Open reefer unit doors. Take 2-3 pictures of the engine compartment interior.'],
  ];

  const dropSteps = [
    [1,  'Front Driver Side Corner',          'Stand at the front driver-side corner. Capture bumper, corner, and front frame.'],
    [2,  'Trailer Annual Inspection',         'Photograph annual inspection sticker/certificate. Expiration date must be visible.'],
    [3,  'Trailer Registration',              'Photograph the trailer registration document. All text must be legible.'],
    [4,  'Driver Side Landing Gear',          'Photograph the driver-side landing gear fully. Show condition and position.'],
    [5,  'Fuel Level',                        'Photograph the fuel gauge or fuel level indicator clearly.'],
    [6,  'Driver Side of Trailer (3 pics)',   'Take at least 3 photos of the full driver side from front to rear.'],
    [7,  'Spare Tire',                        'Photograph the spare tire. Show mounting, condition, and tread.'],
    [8,  'Driver Side Front Axel (3 pics)',   'At least 3 close-up photos of front axel tires on driver side.'],
    [9,  'Driver Side Rear Axel (3 pics)',    'At least 3 close-up photos of rear axel tires on driver side.'],
    [10, 'Back of Trailer + Lights On',       'Capture the full rear of the trailer with all lights illuminated and working.'],
    [11, 'Inside Trailer / Doors',            'Open trailer doors. Photograph the interior, door condition, and seals.'],
    [12, 'License Plate Light',               'Close-up of the license plate and its light. Ensure plate is legible.'],
    [13, 'Passenger Side Rear Axel (3 pics)', 'At least 3 close-up photos of rear axel tires on passenger side.'],
    [14, 'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
    [15, 'Passenger Side of Trailer (3 pics)','Take at least 3 photos of the full passenger side from front to rear.'],
    [16, 'Passenger Side Landing Gear',       'Photograph the passenger-side landing gear fully. Show condition and position.'],
    [17, 'Front Crossmember',                 'Photograph the front crossmember. Show any damage or wear.'],
    [18, 'Passenger Side Front Corner',       'Stand at the passenger-side front corner. Capture bumper, corner, and frame.'],
    [19, 'Front of Trailer',                  'Photograph the full front face of the trailer.'],
    [20, 'Engine Compartment',                'Open reefer unit doors. Take 2-3 pictures of the engine compartment interior.'],
  ];

  const generalSteps = [
    [1,  'Front of Trailer',                  'Photograph the full front face of the trailer.'],
    [2,  'Driver Side Front Corner',          'Stand at the front driver-side corner. Capture bumper, corner, and front frame.'],
    [3,  'Engine Hours',                      'Photograph the engine hours display clearly. Ensure reading is visible.'],
    [4,  'Annual Inspection',                 'Photograph annual inspection sticker/certificate. Expiration date must be visible.'],
    [5,  'Trailer Registration',              'Photograph the trailer registration document. All text must be legible.'],
    [6,  'Fuel Level',                        'Photograph the fuel gauge or fuel level indicator clearly.'],
    [7,  'Driver Side Landing Gear',          'Photograph the driver-side landing gear fully. Show condition and position.'],
    [8,  'Driver Side of Trailer (3 pics)',   'Take at least 3 photos of the full driver side from front to rear.'],
    [9,  'Driver Side Front Axel (3 pics)',   'At least 3 close-up photos of front axel tires on driver side.'],
    [10, 'Driver Side Rear Axel (3 pics)',    'At least 3 close-up photos of rear axel tires on driver side.'],
    [11, 'Back of Trailer + Lights On',       'Capture the full rear of the trailer with all lights illuminated and working.'],
    [12, 'License Plate Light',               'Close-up of the license plate and its light. Ensure plate is legible.'],
    [13, 'Passenger Side of Trailer (3 pics)','Take at least 3 photos of the full passenger side from front to rear.'],
    [14, 'Passenger Side Landing Gear',       'Photograph the passenger-side landing gear fully. Show condition and position.'],
    [15, 'Passenger Side Front Corner',       'Stand at the passenger-side front corner. Capture bumper, corner, and frame.'],
    [16, 'Engine Compartment',                'Open reefer unit doors. Take 2-3 pictures of the engine compartment interior.'],
  ];

  const ins = db.prepare('INSERT INTO inspection_steps (inspection_type, step_number, label, instruction) VALUES (?,?,?,?)');
  pickupSteps.forEach(s => ins.run('pickup', ...s));
  dropSteps.forEach(s => ins.run('drop', ...s));
  generalSteps.forEach(s => ins.run('general', ...s));
}

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