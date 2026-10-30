const path = require('path');
const fs = require('fs');
const backendEnv = path.join(__dirname, '.env');
const rootEnv = path.join(__dirname, '../.env');
if (fs.existsSync(backendEnv)) {
  require('dotenv').config({ path: backendEnv });
} else if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ── Route imports ──────────────────────────────────────────────
const authRoutes       = require('./src/routes/auth');
const scanRoutes       = require('./src/routes/scan');
const studentRoutes    = require('./src/routes/students');
const attendanceRoutes = require('./src/routes/attendance');
const overrideRoutes   = require('./src/routes/override');
const leaveRoutes      = require('./src/routes/leave');
const roomsRoutes      = require('./src/routes/rooms');
const subjectsRoutes   = require('./src/routes/subjects');
const teachersRoutes   = require('./src/routes/teachers');
const { deleteUnregisteredStudents } = require('./src/services/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & Static Assets ────────────────────────────────────
// Disable restrictive CSP in local dev so CDNs (icons, fonts, charts) load smoothly
app.use(helmet({ contentSecurityPolicy: false }));

// In production: restrict CORS to the deployed origin via ALLOWED_ORIGIN env var.
// Falls back to '*' if ALLOWED_ORIGIN is not yet set (monolith same-origin is safe).
// In development: always allow all origins for local testing convenience.
const corsOrigin = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGIN || '*')
  : '*';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Rate limiter for the IoT scan endpoint ────────────────────
const scanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 60,                  // max 60 scans per minute per IP
  message: { error: 'Too many requests — slow down' },
});

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/scan',       scanLimiter, scanRoutes);
app.use('/api/students',   studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/override',   overrideRoutes);
app.use('/api/leave',      leaveRoutes);
app.use('/api/rooms',      roomsRoutes);
app.use('/api/subjects',   subjectsRoutes);
app.use('/api/teachers',   teachersRoutes);

// ── Health check (also used by ESP32 to verify connectivity) ───
app.get('/api/ping', (req, res) => {
  res.json({
    status: 'online',
    server: 'Attendance System API',
    timestamp: new Date().toISOString(),
  });
});

// Expose public config needed by frontend (Supabase URL & Anon key only)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

// Fallback to frontend index.html for non-API routes
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, '../frontend/index.html'));
  }
  next();
});

// ── 404 handler for API routes ─────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nAttendance API running at http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/ping`);
  console.log(`   IoT scan:     POST http://localhost:${PORT}/api/scan`);
  console.log(`   Frontend UI:  http://localhost:${PORT}/\n`);

  // Initial purge and 30-minute recurring cleanup for unregistered accounts > 2 days
  deleteUnregisteredStudents();
  setInterval(deleteUnregisteredStudents, 30 * 60 * 1000);
});
