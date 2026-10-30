// /api/students — CRUD for student management
// GET    /api/students         — list all students (excludes sensitive pin)
// POST   /api/students         — register new student
// GET    /api/students/:id     — get one student + guardians
// PUT    /api/students/:id     — update student info (partial safe update)
// DELETE /api/students/:id     — delete student

const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');
const { hashPassword } = require('./auth');

const SAFE_STUDENT_COLUMNS = 'id, rfid_uid, student_id, full_name, course, year_level, section, created_at';

// GET /api/students — list all students (with optional search)
router.get('/', auth, async (req, res) => {
  try {
    const { search, course, year_level, section } = req.query;

    let query = supabase
      .from('students')
      .select(`${SAFE_STUDENT_COLUMNS}, guardians(id, full_name, phone_number, relationship)`)
      .order('full_name', { ascending: true });

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,student_id.ilike.%${search}%`);
    }
    if (course)      query = query.eq('course', course);
    if (year_level)  query = query.eq('year_level', parseInt(year_level, 10));
    if (section)     query = query.eq('section', section);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ students: data || [] });
  } catch (err) {
    console.error('[GET /students]', err);
    return res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// POST /api/students — register a new student (link RFID UID to student profile + optional guardian)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Students cannot create new student records' });
    }

    const { rfid_uid, student_id, full_name, course, year_level, section, pin, guardian } = req.body;

    if (!student_id || !full_name) {
      return res.status(400).json({ error: 'student_id and full_name are required' });
    }

    // Normalize RFID UID to uppercase colon format if provided (e.g. F3:06:24:38)
    let formattedRfid = null;
    if (rfid_uid && String(rfid_uid).trim() && String(rfid_uid).trim() !== '-') {
      const cleanHex = String(rfid_uid).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      formattedRfid = cleanHex.match(/.{1,2}/g)?.join(':') || rfid_uid.trim();
    }

    const newStudentData = {
      rfid_uid: formattedRfid,
      student_id: String(student_id).trim(),
      full_name: String(full_name).trim(),
      course: course ? String(course).trim() : 'Elementary',
      year_level: year_level ? parseInt(year_level, 10) : 1,
      section: section ? String(section).trim() : 'Diamond',
    };

    if (pin && String(pin).trim().length >= 4) {
      newStudentData.pin = hashPassword(String(pin).trim());
    }

    const { data, error } = await supabase
      .from('students')
      .insert(newStudentData)
      .select(SAFE_STUDENT_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        const field = error.message.includes('rfid_uid') ? 'RFID UID' : 'Student ID';
        return res.status(409).json({ error: `${field} already exists` });
      }
      throw error;
    }

    // If guardian info was submitted, insert record into guardians table
    if (guardian && (guardian.full_name || guardian.phone_number)) {
      await supabase.from('guardians').insert({
        student_id: data.id,
        full_name: String(guardian.full_name || '').trim(),
        phone_number: String(guardian.phone_number || '').trim(),
        relationship: String(guardian.relationship || 'Parent').trim()
      }).catch(gErr => {
        console.warn('[POST /students] Failed to insert guardian record:', gErr.message);
      });
    }

    return res.status(201).json({ student: data });
  } catch (err) {
    console.error('[POST /students]', err);
    return res.status(500).json({ error: 'Failed to register student' });
  }
});

// GET /api/students/:id — get a single student + their guardians
router.get('/:id', auth, async (req, res) => {
  try {
    // If student role, ensure they can only view their own profile
    if (req.user?.role === 'student' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Access denied: can only view your own student profile' });
    }

    const { data: student, error } = await supabase
      .from('students')
      .select(`
        ${SAFE_STUDENT_COLUMNS},
        guardians(id, full_name, phone_number, relationship)
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.json({ student });
  } catch (err) {
    console.error('[GET /students/:id]', err);
    return res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// PUT /api/students/:id — update student info (partial safe update)
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Students cannot modify other students profiles' });
    }

    const { rfid_uid, student_id, full_name, course, year_level, section, pin } = req.body;

    const updates = {};
    if (rfid_uid !== undefined) {
      const cleanHex = String(rfid_uid).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      updates.rfid_uid = cleanHex.match(/.{1,2}/g)?.join(':') || rfid_uid;
    }
    if (student_id !== undefined) updates.student_id = String(student_id).trim();
    if (full_name !== undefined)  updates.full_name = String(full_name).trim();
    if (course !== undefined)     updates.course = String(course).trim();
    if (year_level !== undefined) updates.year_level = parseInt(year_level, 10);
    if (section !== undefined)    updates.section = String(section).trim();
    if (pin !== undefined && String(pin).trim().length >= 4) {
      updates.pin = hashPassword(String(pin).trim());
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }

    const { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', req.params.id)
      .select(SAFE_STUDENT_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        const field = error.message.includes('rfid_uid') ? 'RFID UID' : 'Student ID';
        return res.status(409).json({ error: `${field} already exists` });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Student not found' });

    return res.json({ student: data });
  } catch (err) {
    console.error('[PUT /students/:id]', err);
    return res.status(500).json({ error: 'Failed to update student' });
  }
});

// DELETE /api/students/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Students cannot delete records' });
    }

    const { error } = await supabase
      .from('students')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    return res.json({ success: true, message: 'Student deleted' });
  } catch (err) {
    console.error('[DELETE /students/:id]', err);
    return res.status(500).json({ error: 'Failed to delete student' });
  }
});

module.exports = router;
