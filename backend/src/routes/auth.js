const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../supabase');
const { generateToken } = require('../utils/token');
const auth = require('../middleware/auth');

// ── Timing-Safe String Comparison ────────────────────────────────
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Prevent timing difference based on length by running a dummy compare
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Password & PIN Hashing Helpers ──────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  // Format: salt:hash
  if (stored.includes(':')) {
    const [salt, originalHash] = stored.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return safeCompare(hash, originalHash);
  }
  // Plain text fallback
  return safeCompare(password, stored);
}

// ── POST /api/auth/student ───────────────────────────────────────
// Authenticate student by Full Name (or LRN / student_id) + PIN
router.post('/student', async (req, res) => {
  try {
    const identifier = (req.body.full_name || req.body.name || req.body.student_id || req.body.lrn || req.body.username || '').trim();
    const pin = (req.body.pin || req.body.password || '').trim();

    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Full name or Student ID / LRN is required' });
    }
    if (!pin) {
      return res.status(400).json({ success: false, error: 'PIN / Password is required' });
    }

    // Lookup student in Supabase: check full_name first, then fallback to student_id
    let student = null;
    const { data: byName, error: errName } = await supabase
      .from('students')
      .select('id, student_id, full_name, rfid_uid, course, year_level, section, pin')
      .ilike('full_name', identifier)
      .maybeSingle();

    if (errName) throw errName;

    if (byName) {
      student = byName;
    } else {
      const { data: byId, error: errId } = await supabase
        .from('students')
        .select('id, student_id, full_name, rfid_uid, course, year_level, section, pin')
        .eq('student_id', identifier)
        .maybeSingle();

      if (errId) throw errId;
      student = byId;
    }

    if (!student) {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        error: `Account does not exist. No student record found for "${identifier}".`
      });
    }

    // Determine expected PIN:
    // 1. student.pin if explicitly set
    // 2. Default PIN = last 4 digits of LRN (or full student_id if < 4 digits)
    const defaultPin = student.student_id && student.student_id.length >= 4 
      ? student.student_id.slice(-4) 
      : student.student_id;

    let isPinValid = false;
    if (student.pin) {
      if (student.pin.includes(':')) {
        isPinValid = verifyPassword(pin, student.pin);
      } else {
        isPinValid = safeCompare(pin, student.pin) || safeCompare(pin, defaultPin);
        // Automatically upgrade plaintext PIN to PBKDF2 hash
        if (isPinValid) {
          const upgradedHash = hashPassword(pin);
          await supabase.from('students').update({ pin: upgradedHash }).eq('id', student.id);
        }
      }
    } else {
      isPinValid = safeCompare(pin, defaultPin);
    }

    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        code: 'INCORRECT_PASSWORD',
        error: `Incorrect password. Default PIN is the last 4 digits of your LRN (${defaultPin}).`
      });
    }

    // Issue cryptographically secure signed session token
    const token = generateToken({
      id: student.id,
      student_id: student.student_id,
      role: 'student'
    });

    return res.json({
      success: true,
      token,
      user: {
        id: student.id,
        name: student.full_name,
        full_name: student.full_name,
        student_id: student.student_id,
        rfid: student.rfid_uid,
        course: student.course || 'Elementary',
        section: student.section || 'Diamond',
        year: student.year_level || 1,
        role: 'student'
      }
    });
  } catch (err) {
    console.error('[POST /api/auth/student]', err);
    return res.status(500).json({ success: false, error: 'Server authentication error' });
  }
});

// ── POST /api/auth/register-student ──────────────────────────────
// Allow students to self-register via the Register screen and log in immediately
router.post('/register-student', async (req, res) => {
  try {
    const { student_id, full_name, rfid_uid, course, year_level, section, pin } = req.body;

    if (!student_id || !full_name) {
      return res.status(400).json({ success: false, error: 'Student ID (LRN) and Full Name are required' });
    }

    // Clean and normalize RFID UID if provided.
    // If no card is registered yet, use an AUTO- placeholder so the NOT NULL
    // constraint is satisfied. The cleanup service already purges AUTO-* accounts
    // that remain untagged after 2 days.
    let formattedRfid;
    if (rfid_uid && String(rfid_uid).trim() && String(rfid_uid).trim() !== '-') {
      const cleanHex = String(rfid_uid).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      formattedRfid = cleanHex.match(/.{1,2}/g)?.join(':') || rfid_uid.trim();
    } else {
      const trimmedId = String(student_id || '').trim();
      formattedRfid = `AUTO-${trimmedId}`;
    }

    const trimmedStudentId = String(student_id).trim();
    const defaultPin = trimmedStudentId.length >= 4 ? trimmedStudentId.slice(-4) : trimmedStudentId;
    const finalPin = pin && String(pin).trim().length >= 4 ? String(pin).trim() : defaultPin;

    const newStudentData = {
      student_id: trimmedStudentId,
      full_name: String(full_name).trim(),
      rfid_uid: formattedRfid,
      course: course ? String(course).trim() : 'Elementary',
      year_level: year_level ? parseInt(year_level, 10) : 1,
      section: section ? String(section).trim() : 'Diamond',
      pin: hashPassword(finalPin)
    };

    const { data: student, error } = await supabase
      .from('students')
      .insert(newStudentData)
      .select('id, student_id, full_name, rfid_uid, course, year_level, section')
      .single();

    if (error) {
      if (error.code === '23505') {
        const field = error.message.includes('rfid_uid') ? 'RFID Card UID' : 'Student ID (LRN)';
        return res.status(409).json({ success: false, error: `${field} is already registered.` });
      }
      throw error;
    }

    const token = generateToken({
      id: student.id,
      student_id: student.student_id,
      role: 'student'
    });

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: student.id,
        name: student.full_name,
        student_id: student.student_id,
        rfid: student.rfid_uid,
        course: student.course || 'Elementary',
        section: student.section || 'N/A',
        year: student.year_level || 1,
        role: 'student'
      }
    });
  } catch (err) {
    console.error('[POST /api/auth/register-student]', err);
    return res.status(500).json({ success: false, error: err.message || 'Registration failed' });
  }
});

// ── POST /api/auth/teacher ───────────────────────────────────────
// Authenticate teacher by email OR full name + password
router.post('/teacher', async (req, res) => {
  try {
    const identifier = (req.body.email || req.body.name || req.body.full_name || req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Full name or Email is required' });
    }
    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    // Lookup instructor in Supabase
    let instructor = null;
    if (identifier.includes('@')) {
      const { data, error } = await supabase
        .from('instructors')
        .select('id, full_name, email, role, password_hash')
        .ilike('email', identifier)
        .maybeSingle();
      if (error) throw error;
      instructor = data;
    } else {
      const { data, error } = await supabase
        .from('instructors')
        .select('id, full_name, email, role, password_hash')
        .ilike('full_name', identifier)
        .maybeSingle();
      if (error) throw error;
      instructor = data;
    }

    if (!instructor) {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        error: `Account does not exist. No teacher record found for "${identifier}".`
      });
    }

    // Validate password
    let isValid = false;
    if (!instructor.password_hash) {
      // If no password set yet, default initial password is 'teacher123'
      if (password === 'teacher123') {
        isValid = true;
        // Auto-hash and save to DB
        const newHash = hashPassword(password);
        await supabase.from('instructors').update({ password_hash: newHash }).eq('id', instructor.id);
      }
    } else {
      isValid = verifyPassword(password, instructor.password_hash);
      // If stored as plain text, upgrade to salted hash on successful login
      if (isValid && !instructor.password_hash.includes(':')) {
        const upgradedHash = hashPassword(password);
        await supabase.from('instructors').update({ password_hash: upgradedHash }).eq('id', instructor.id);
      }
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        code: 'INCORRECT_PASSWORD',
        error: 'Incorrect password for teacher account.'
      });
    }

    // Issue cryptographically secure signed session token
    const token = generateToken({
      id: instructor.id,
      instructor_id: instructor.id,
      email: instructor.email,
      role: instructor.role || 'instructor'
    });

    return res.json({
      success: true,
      token,
      user: {
        id: instructor.id,
        name: instructor.full_name,
        full_name: instructor.full_name,
        email: instructor.email,
        role: instructor.role || 'instructor'
      }
    });
  } catch (err) {
    console.error('[POST /api/auth/teacher]', err);
    return res.status(500).json({ success: false, error: 'Server authentication error' });
  }
});

// ── POST /api/auth/admin ─────────────────────────────────────────
// Authenticate admin by username (admin) + ADMIN_PASSWORD from env
router.post('/admin', async (req, res) => {
  try {
    const username = (req.body.username || req.body.full_name || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    const expectedUsername = 'admin';
    const configuredPassword = process.env.ADMIN_PASSWORD || 'admin123';

    // Timing-safe comparison to prevent side-channel timing attacks
    const isUsernameMatch = safeCompare(username, expectedUsername);
    let isPasswordMatch = false;

    if (configuredPassword.includes(':')) {
      // Configured as salt:hash
      isPasswordMatch = verifyPassword(password, configuredPassword);
    } else {
      isPasswordMatch = safeCompare(password, configuredPassword);
    }

    if (!isUsernameMatch) {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        error: 'Invalid administrator username.'
      });
    }

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        code: 'INCORRECT_PASSWORD',
        error: 'Incorrect administrator password.'
      });
    }

    // Issue cryptographically secure signed session token
    const token = generateToken({
      id: '00000000-0000-0000-0000-000000000000',
      username: 'admin',
      role: 'admin'
    });

    return res.json({
      success: true,
      token,
      user: {
        username: 'admin',
        role: 'admin'
      }
    });
  } catch (err) {
    console.error('[POST /api/auth/admin]', err);
    return res.status(500).json({ success: false, error: 'Server authentication error' });
  }
});

// ── POST /api/auth/change-pin ────────────────────────────────────
// Allow logged-in student to update their PIN
router.post('/change-pin', auth, async (req, res) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({ error: 'Only students can change PIN' });
    }

    const { current_pin, new_pin } = req.body;
    if (!current_pin || !new_pin) {
      return res.status(400).json({ error: 'current_pin and new_pin are required' });
    }

    if (String(new_pin).trim().length < 4) {
      return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
    }

    const { data: student, error: fetchErr } = await supabase
      .from('students')
      .select('id, student_id, pin')
      .eq('id', req.user.id)
      .single();

    if (fetchErr || !student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const defaultPin = student.student_id && student.student_id.length >= 4 
      ? student.student_id.slice(-4) 
      : student.student_id;

    const isCurrentValid = student.pin 
      ? verifyPassword(current_pin, student.pin)
      : safeCompare(current_pin, defaultPin);

    if (!isCurrentValid) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }

    const hashedPin = hashPassword(String(new_pin).trim());
    const { error: updateErr } = await supabase
      .from('students')
      .update({ pin: hashedPin })
      .eq('id', student.id);

    if (updateErr) throw updateErr;

    return res.json({ success: true, message: 'PIN updated successfully' });
  } catch (err) {
    console.error('[POST /api/auth/change-pin]', err);
    return res.status(500).json({ error: 'Failed to update PIN' });
  }
});

module.exports = router;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.safeCompare = safeCompare;

