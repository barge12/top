const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const { initDb, getDb, hashPassword, verifyPassword } = require('./database');

const PORT = 80;

// Session Management (In-Memory)
const sessions = new Map(); // token -> sessionObj

// Clean up expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expires < now) {
      sessions.delete(token);
    }
  }
}, 60 * 60 * 1000);

// Helper to parse cookies
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

// Helper to parse request body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Geçersiz JSON verisi'));
      }
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

// Response helpers
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, message, status = 400) {
  sendJSON(res, { error: message }, status);
}

function sendRedirect(res, location) {
  res.writeHead(302, { 'Location': location });
  res.end();
}

// Request Handler
async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Session & Auth Retrieval
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.session_token;
  let session = null;

  if (sessionToken && sessions.has(sessionToken)) {
    const s = sessions.get(sessionToken);
    if (s.expires > Date.now()) {
      session = s;
      // Refresh session expiration (extend by 1 day)
      s.expires = Date.now() + 24 * 60 * 60 * 1000;
    } else {
      sessions.delete(sessionToken);
    }
  }

  // Helper auth checks
  const isLoggedIn = () => !!session;
  const isAdmin = () => session && session.role === 'admin';

  // --- API ROUTES ---

  // AUTH API: GET /api/auth/me
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (isLoggedIn()) {
      return sendJSON(res, {
        loggedIn: true,
        user: { id: session.userId, username: session.username, role: session.role }
      });
    }
    return sendJSON(res, { loggedIn: false });
  }

  // AUTH API: POST /api/auth/login
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await getRequestBody(req);
      if (!username || !password) {
        return sendError(res, 'Kullanıcı adı ve şifre zorunludur.');
      }

      const db = getDb();
      const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
      const user = stmt.get(username);

      if (!user) {
        return sendError(res, 'Hatalı kullanıcı adı veya şifre.', 401);
      }

      // Check if user is active
      if (user.active === 0) {
        return sendError(res, 'Kullanıcı pasif, giriş yapılamaz.', 403);
      }

      const isMatch = verifyPassword(password, user.password);
      if (!isMatch) {
        return sendError(res, 'Hatalı kullanıcı adı veya şifre.', 401);
      }

      // Generate session token
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, {
        userId: user.id,
        username: user.username,
        role: user.role,
        expires: Date.now() + 24 * 60 * 60 * 1000 // 1 day
      });

      // Set cookie
      res.writeHead(200, {
        'Set-Cookie': `session_token=${token}; HttpOnly; Path=/; Max-Age=86400`,
        'Content-Type': 'application/json; charset=utf-8'
      });
      return res.end(JSON.stringify({
        success: true,
        user: { id: user.id, username: user.username, role: user.role }
      }));

    } catch (err) {
      return sendError(res, err.message, 400);
    }
  }

  // AUTH API: POST /api/auth/logout
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (sessionToken) {
      sessions.delete(sessionToken);
    }
    res.writeHead(200, {
      'Set-Cookie': 'session_token=; HttpOnly; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Content-Type': 'application/json; charset=utf-8'
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // For all other /api routes, check login
  if (pathname.startsWith('/api/')) {
    if (!isLoggedIn()) {
      return sendError(res, 'Lütfen giriş yapın.', 401);
    }

    const db = getDb();

    // 1. Locations GET /api/locations
    if (pathname === '/api/locations' && req.method === 'GET') {
      try {
        const locations = db.prepare('SELECT * FROM locations ORDER BY name ASC').all();
        return sendJSON(res, locations);
      } catch (err) {
        return sendError(res, 'Lokasyonlar getirilemedi.', 500);
      }
    }

    // 2. Locations POST /api/locations (Admin Only)
    if (pathname === '/api/locations' && req.method === 'POST') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const { name } = await getRequestBody(req);
        if (!name || !name.trim()) return sendError(res, 'Lokasyon adı zorunludur.');

        const stmt = db.prepare('INSERT INTO locations (name) VALUES (?)');
        const result = stmt.run(name.trim());
        return sendJSON(res, { id: result.lastInsertRowid, name: name.trim() }, 201);
      } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return sendError(res, 'Bu lokasyon zaten mevcut.');
        }
        return sendError(res, 'Lokasyon eklenemedi.', 500);
      }
    }

    // 3. Locations DELETE /api/locations/:id (Admin Only)
    if (pathname.startsWith('/api/locations/') && req.method === 'DELETE') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const parts = pathname.split('/');
        const id = parts[3];
        const stmt = db.prepare('DELETE FROM locations WHERE id = ?');
        stmt.run(id);
        return sendJSON(res, { success: true, message: 'Lokasyon başarıyla silindi.' });
      } catch (err) {
        return sendError(res, 'Lokasyon silinemedi.', 500);
      }
    }

    // 4. Rooms GET /api/locations/:locationId/rooms
    // Path: /api/locations/:locationId/rooms
    const roomMatch = pathname.match(/^\/api\/locations\/(\d+)\/rooms$/);
    if (roomMatch && req.method === 'GET') {
      try {
        const locationId = roomMatch[1];
        const rooms = db.prepare('SELECT * FROM rooms WHERE location_id = ? ORDER BY name ASC').all(locationId);
        return sendJSON(res, rooms);
      } catch (err) {
        return sendError(res, 'Odalar getirilemedi.', 500);
      }
    }

    // 5. Rooms POST /api/rooms (Admin Only)
    if (pathname === '/api/rooms' && req.method === 'POST') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const { locationId, name } = await getRequestBody(req);
        if (!locationId || !name || !name.trim()) {
          return sendError(res, 'Lokasyon ve oda adı zorunludur.');
        }

        // Validate location exists
        const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId);
        if (!loc) return sendError(res, 'Belirtilen lokasyon bulunamadı.', 404);

        const stmt = db.prepare('INSERT INTO rooms (location_id, name) VALUES (?, ?)');
        const result = stmt.run(locationId, name.trim());
        return sendJSON(res, { id: result.lastInsertRowid, location_id: locationId, name: name.trim() }, 201);
      } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return sendError(res, 'Bu lokasyonda aynı isimde bir oda zaten mevcut.');
        }
        return sendError(res, 'Oda eklenemedi.', 500);
      }
    }

    // 6. Rooms DELETE /api/rooms/:id (Admin Only)
    if (pathname.startsWith('/api/rooms/') && req.method === 'DELETE') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const parts = pathname.split('/');
        const id = parts[3];
        const stmt = db.prepare('DELETE FROM rooms WHERE id = ?');
        stmt.run(id);
        return sendJSON(res, { success: true, message: 'Oda başarıyla silindi.' });
      } catch (err) {
        return sendError(res, 'Oda silinemedi.', 500);
      }
    }

    // 7. Bookings GET /api/bookings
    if (pathname === '/api/bookings' && req.method === 'GET') {
      console.log('🔍 Bookings request - query:', { date: parsedUrl.searchParams.get('date'), roomId: parsedUrl.searchParams.get('roomId'), locationId: parsedUrl.searchParams.get('locationId') });
      try {
        const date = parsedUrl.searchParams.get('date');
        const roomId = parsedUrl.searchParams.get('roomId');
        const locationId = parsedUrl.searchParams.get('locationId');

        let query = `
          SELECT b.*, r.name as room_name, l.name as location_name, u.username as booked_by
          FROM bookings b
          JOIN rooms r ON b.room_id = r.id
          JOIN locations l ON r.location_id = l.id
          LEFT JOIN users u ON b.user_id = u.id
          WHERE 1=1
        `;
        const params = [];

        if (date) {
          query += ` AND substr(b.start_time, 1, 10) = ?`;
          params.push(date);
        }
        if (roomId) {
          query += ` AND b.room_id = ?`;
          params.push(roomId);
        }
        if (locationId) {
          query += ` AND r.location_id = ?`;
          params.push(locationId);
        }

        query += ` ORDER BY b.start_time ASC`;

        const bookings = db.prepare(query).all(...params);
        console.log('🔍 Bookings retrieved:', bookings.length);
        return sendJSON(res, bookings);
        return sendJSON(res, bookings);
      } catch (err) {
        return sendError(res, 'Rezervasyonlar getirilemedi.', 500);
      }
    }

    // 8. Bookings POST /api/bookings
    if (pathname === '/api/bookings' && req.method === 'POST') {
      try {
        const { roomId, title, startTime, endTime, type, description } = await getRequestBody(req);

        if (!roomId || !title || !startTime || !endTime || !type) {
          return sendError(res, 'Eksik rezervasyon bilgisi.');
        }
        // Admin users are not allowed to create reservations
        if (session.role === 'admin') {
          return sendError(res, 'Admin kullanıcıları rezervasyon yapamaz.', 403);
        }

        if (startTime >= endTime) {
          return sendError(res, 'Bitiş saati başlangıç saatinden sonra olmalıdır.');
        }

        // Verify room
        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
        if (!room) return sendError(res, 'Oda bulunamadı.', 404);

        // Check conflict (overlap query)
        const conflict = db.prepare(`
          SELECT * FROM bookings 
          WHERE room_id = ? 
            AND start_time < ? 
            AND end_time > ?
        `).get(roomId, endTime, startTime);

        if (conflict) {
          return sendJSON(res, { error: `Bu tarih ve saat diliminde (${startTime.split(' ')[1]} - ${endTime.split(' ')[1]}) oda zaten dolu.` }, 409);
        }

        const stmt = db.prepare(`
          INSERT INTO bookings (room_id, user_id, title, start_time, end_time, type, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(roomId, session.userId, title.trim(), startTime, endTime, type, description?.trim() || null);

        return sendJSON(res, {
          success: true,
          booking: {
            id: result.lastInsertRowid,
            room_id: roomId,
            title: title.trim(),
            start_time: startTime,
            end_time: endTime,
            type,
            description
          }
        }, 201);
      } catch (err) {
        return sendError(res, err.message, 500);
      }
    }

    // 9. Bookings DELETE /api/bookings/:id
    if (pathname.startsWith('/api/bookings/') && req.method === 'DELETE') {
      try {
        const parts = pathname.split('/');
        const id = parts[3];

        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
        if (!booking) return sendError(res, 'Rezervasyon bulunamadı.', 404);

        // Authorization: Admin can cancel any, standard user only their own
        if (!isAdmin() && booking.user_id !== session.userId) {
          return sendError(res, 'Başkasının rezervasyonunu silemezsiniz.', 403);
        }

        db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
        return sendJSON(res, { success: true, message: 'Rezervasyon iptal edildi.' });
      } catch (err) {
        return sendError(res, 'Rezervasyon silinemedi.', 500);
      }
    }

    // 10. Users GET /api/users (Admin Only)
    if (pathname === '/api/users' && req.method === 'GET') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const users = db.prepare('SELECT id, username, role, active FROM users ORDER BY username ASC').all();
        return sendJSON(res, users);
      } catch (err) {
        return sendError(res, 'Kullanıcılar getirilemedi.', 500);
      }
    }

    // 11. Users POST /api/users (Admin Only)
    if (pathname === '/api/users' && req.method === 'POST') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const { username, password, role } = await getRequestBody(req);

        if (!username || !password || !role) {
          return sendError(res, 'Kullanıcı adı, şifre ve rol zorunludur.');
        }

        const cleanUsername = username.trim();
        if (cleanUsername.length < 3) {
          return sendError(res, 'Kullanıcı adı en az 3 karakter olmalıdır.');
        }
        if (password.length < 6) {
          return sendError(res, 'Şifre en az 6 karakter olmalıdır.');
        }
        if (role !== 'admin' && role !== 'user') {
          return sendError(res, 'Geçersiz rol.');
        }

        const hashed = hashPassword(password);
        const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
        const result = stmt.run(cleanUsername, hashed, role);

        return sendJSON(res, {
          success: true,
          user: { id: result.lastInsertRowid, username: cleanUsername, role }
        }, 201);
      } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return sendError(res, 'Bu kullanıcı adı zaten alınmış.');
        }
        return sendError(res, 'Kullanıcı oluşturulamadı.', 500);
      }
    }

    // 12. Users DELETE /api/users/:id (Admin Only)
    if (pathname.startsWith('/api/users/') && req.method === 'DELETE') {
      if (!isAdmin()) return sendError(res, 'Bu işlem için yetkiniz yok.', 403);
      try {
        const parts = pathname.split('/');
        const id = parseInt(parts[3]);

        if (id === session.userId) {
          return sendError(res, 'Kendinizi silemezsiniz.');
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!user) return sendError(res, 'Kullanıcı bulunamadı.', 404);

        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return sendJSON(res, { success: true, message: 'Kullanıcı başarıyla silindi.' });
      } catch (err) {
        return sendError(res, 'Kullanıcı silinemedi.', 500);
      }
    }

    // API not found
    return sendError(res, 'API bulunamadı.', 404);
  }

  // --- STATIC FILE SERVING ---

  let filename = pathname;
  if (filename === '/') {
    filename = '/index.html';
  }

  // Require login for HTML pages except login.html
  if (filename.endsWith('.html') && filename !== '/login.html') {
    if (!isLoggedIn()) {
      return sendRedirect(res, '/login.html');
    }
    // Require admin for admin.html
    if (filename === '/admin.html' && !isAdmin()) {
      return sendRedirect(res, '/index.html');
    }
  }

  const filePath = path.join(__dirname, 'public', filename);

  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Sayfa bulunamadı.');
    }

    // Determine content type
    let contentType = 'text/html; charset=utf-8';
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.css') {
      contentType = 'text/css; charset=utf-8';
    } else if (ext === '.js') {
      contentType = 'application/javascript; charset=utf-8';
    } else if (ext === '.json') {
      contentType = 'application/json; charset=utf-8';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (ext === '.ico') {
      contentType = 'image/x-icon';
    }

    // Read and serve
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Sunucu hatası.');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

// Start Server
try {
  initDb();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('İstek Hatası:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Kritik sunucu hatası.');
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} portunda başarıyla çalışıyor.`);
  });
} catch (err) {
  console.error('Başlatma Hatası:', err);
}
