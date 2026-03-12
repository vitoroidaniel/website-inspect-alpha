const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:QDMCeTBgQfovbdUlDROlcsVXYxcizJgl@postgres.railway.internal:5432/railway',
});

// Helper to create a db-like interface compatible with the existing code
const db = {
  prepare: (sql) => ({
    get: (...args) => {
      return pool.query(sql, args).then(res => res.rows[0]);
    },
    all: (...args) => {
      return pool.query(sql, args).then(res => res.rows);
    },
    run: (...args) => {
      return pool.query(sql, args).then(res => res);
    }
  }),
  exec: (sql) => {
    return pool.query(sql);
  }
};

// Initialize database tables
const initDatabase = async () => {
  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('driver','agent','superadmin')),
      truck_model TEXT DEFAULT '',
      truck_number TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // WebAuthn credentials table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      transports TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Inspections table
  await pool.query(`
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
      started_at TIMESTAMP, 
      submitted_at TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES users(id)
    );
  `);

  // Inspection photos table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inspection_photos (
      id SERIAL PRIMARY KEY,
      inspection_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      step_label TEXT,
      file_path TEXT NOT NULL,
      latitude REAL, 
      longitude REAL, 
      taken_at TIMESTAMP,
      FOREIGN KEY(inspection_id) REFERENCES inspections(id)
    );
  `);

  // Inspection steps table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inspection_steps (
      id SERIAL PRIMARY KEY,
      inspection_type TEXT NOT NULL DEFAULT 'pickup',
      step_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      instruction TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Safe migrations - add columns if they don't exist
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS truck_model TEXT DEFAULT ''`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS truck_number TEXT DEFAULT ''`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS truck_number TEXT`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS inspection_type TEXT NOT NULL DEFAULT 'pickup'`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS step_label TEXT`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE inspection_steps ADD COLUMN IF NOT EXISTS inspection_type TEXT NOT NULL DEFAULT 'pickup'`);
  } catch (e) {}

  // Seed inspection steps
  const stepsCount = await pool.query('SELECT COUNT(*) as c FROM inspection_steps');
  if (parseInt(stepsCount.rows[0].c) === 0) {
    const ins = pool.query('INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES ($1,$2,$3,$4)');
    
    const pickup = [
      [1,'Engine Hours','Photograph the engine hours display clearly. Ensure reading is visible.'],
      [2,'Trailer Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      [3,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      [4,'Front Driver Side Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      [5,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      [6,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      [7,'Spare Tire','Photograph the spare tire. Show mounting, condition, and tread.'],
      [8,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      [9,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      [10,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      [11,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      [12,'Inside Trailer / Doors','Open trailer doors. Photograph interior, door condition, and seals.'],
      [13,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      [14,'Passenger Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on passenger side.'],
      [15,'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
      [16,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      [17,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      [18,'Front Crossmember','Photograph the front crossmember. Show any damage or wear.'],
      [19,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      [20,'Front of Trailer','Photograph the full front face of the trailer.'],
      [21,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
    ];
    const drop = [
      [1,'Front Driver Side Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      [2,'Trailer Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      [3,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      [4,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      [5,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      [6,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      [7,'Spare Tire','Photograph the spare tire. Show mounting, condition, and tread.'],
      [8,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      [9,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      [10,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      [11,'Inside Trailer / Doors','Open trailer doors. Photograph interior, door condition, and seals.'],
      [12,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      [13,'Passenger Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on passenger side.'],
      [14,'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
      [15,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      [16,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      [17,'Front Crossmember','Photograph the front crossmember. Show any damage or wear.'],
      [18,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      [19,'Front of Trailer','Photograph the full front face of the trailer.'],
      [20,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
    ];
    const general = [
      [1,'Front of Trailer','Photograph the full front face of the trailer.'],
      [2,'Driver Side Front Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      [3,'Engine Hours','Photograph the engine hours display clearly. Ensure reading is visible.'],
      [4,'Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      [5,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      [6,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      [7,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      [8,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      [9,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      [10,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      [11,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      [12,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      [13,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      [14,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      [15,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      [16,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
    ];
    
    for (const s of pickup) await ins.run('pickup', ...s);
    for (const s of drop) await ins.run('drop', ...s);
    for (const s of general) await ins.run('general', ...s);
  }

  // Seed default users
  const usersCount = await pool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(usersCount.rows[0].c) === 0) {
    await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)',
      ['admin','admin@fleetinspect.com',bcrypt.hashSync('admin123',10),'System Admin','superadmin']
    );
    await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)',
      ['dispatch','dispatch@fleetinspect.com',bcrypt.hashSync('dispatch123',10),'Sarah Mitchell','agent']
    );
    await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['driver1','james@fleetinspect.com',bcrypt.hashSync('driver123',10),'James Rodriguez','driver','Freightliner Cascadia 2022','TRK-001']
    );
    await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['driver2','mike@fleetinspect.com',bcrypt.hashSync('driver123',10),'Mike Thompson','driver','Kenworth T680 2021','TRK-002']
    );
    console.log('Seeded: admin/admin123, dispatch/dispatch123, driver1/driver123, driver2/driver123');
  }
};

// Initialize on startup
initDatabase().catch(console.error);

module.exports = db;

