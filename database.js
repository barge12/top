const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('path');

const dbPath = path.join(__dirname, 'meetings.db');
let db = null;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [salt, hash] = storedHash.split(':');
    const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === checkHash;
  } catch (e) {
    return false;
  }
}

function initDb() {
  db = new DatabaseSync(dbPath);

  // Enable foreign key support
  db.exec('PRAGMA foreign_keys = ON');

  // Create Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Ensure 'active' column exists in 'users' table
  try {
    db.prepare('SELECT active FROM users LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
      console.log('Added active column to users table.');
    } catch (err) {
      console.error('Failed to add active column:', err);
    }
  }

  // Ensure 'must_change_password' column exists in 'users' table
  try {
    db.prepare('SELECT must_change_password FROM users LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
      console.log('Added must_change_password column to users table.');
    } catch (err) {
      console.error('Failed to add must_change_password column:', err);
    }
  }

  // Create Locations Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  // Create Rooms Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
      UNIQUE(location_id, name)
    )
  `);

  // Create Bookings Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL, -- Format: YYYY-MM-DD HH:MM
      end_time TEXT NOT NULL,   -- Format: YYYY-MM-DD HH:MM
      type TEXT NOT NULL,       -- 'Dış Katılımcı', 'Protokol', 'Standart'
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create Notifications Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Seed default admin user if it doesn't exist


  const stmtAdmin = db.prepare('SELECT * FROM users WHERE username = ?');
  const adminExists = stmtAdmin.get('admin');
  if (!adminExists) {
    const hashedPassword = hashPassword('admin123');
    const stmtInsertAdmin = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
    stmtInsertAdmin.run('admin', hashedPassword, 'admin');
    console.log('Default admin user seeded successfully: admin / admin123');
  }

  // Seed default locations if empty

  const stmtLocCount = db.prepare('SELECT COUNT(*) as count FROM locations');
  const locationCount = stmtLocCount.get();
  if (locationCount.count === 0) {
    const stmtInsertLoc = db.prepare('INSERT INTO locations (name) VALUES (?)');

    stmtInsertLoc.run('Ankara');
    const ankaraRow = db.prepare('SELECT id FROM locations WHERE name = ?').get('Ankara');
    const ankaraId = ankaraRow.id;

    stmtInsertLoc.run('İstanbul');
    const istanbulRow = db.prepare('SELECT id FROM locations WHERE name = ?').get('İstanbul');
    const istanbulId = istanbulRow.id;

    const stmtInsertRoom = db.prepare('INSERT INTO rooms (location_id, name) VALUES (?, ?)');
    stmtInsertRoom.run(ankaraId, '1.Kat Büyük Oda');
    stmtInsertRoom.run(ankaraId, '1.Kat Küçük Oda');
    stmtInsertRoom.run(istanbulId, 'Ana Bina 2.Kat Makam Top.');
    stmtInsertRoom.run(istanbulId, 'Yeşil Köşk Top.');
    console.log('Sample locations and rooms seeded successfully.');
  }

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

module.exports = {
  initDb,
  getDb,
  hashPassword,
  verifyPassword
};
