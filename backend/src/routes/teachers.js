// /api/teachers — Teacher Management
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');
const { hashPassword } = require('./auth');

// GET /api/teachers — List all teachers
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('instructors')
      .select('id, full_name, email, role, created_at')
      .order('full_name', { ascending: true });

    if (error) throw error;
    return res.json({ teachers: data || [] });
  } catch (err) {
    console.error('[GET /teachers]', err);
    return res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// POST /api/teachers — Add new teacher
router.post('/', auth, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can create teacher accounts' });
    }

    const { full_name, email, role = 'instructor', password } = req.body;

    if (!full_name || !email) {
      return res.status(400).json({ error: 'Full name and email are required' });
    }

    const newTeacher = {
      full_name: full_name.trim(),
      email: email.trim().toLowerCase(),
      role: role === 'admin' ? 'admin' : 'instructor',
      password_hash: hashPassword(password ? String(password).trim() : 'teacher123')
    };

    const { data, error } = await supabase
      .from('instructors')
      .insert(newTeacher)
      .select('id, full_name, email, role, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A teacher with this email already exists' });
      }
      throw error;
    }

    return res.status(201).json({ teacher: data });
  } catch (err) {
    console.error('[POST /teachers]', err);
    return res.status(500).json({ error: 'Failed to add teacher' });
  }
});

// PUT /api/teachers/:id — Update teacher
router.put('/:id', auth, async (req, res) => {
  try {
    const targetId = req.params.id;

    // Only admin or the teacher themselves can update their profile
    if (req.user?.role !== 'admin' && req.user?.id !== targetId && req.user?.instructor_id !== targetId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { full_name, email, role, password } = req.body;
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name.trim();
    if (email !== undefined)     updates.email = email.trim().toLowerCase();
    if (role !== undefined && req.user?.role === 'admin') updates.role = role;
    if (password !== undefined && String(password).trim().length >= 6) {
      updates.password_hash = hashPassword(String(password).trim());
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    const { data, error } = await supabase
      .from('instructors')
      .update(updates)
      .eq('id', targetId)
      .select('id, full_name, email, role, created_at')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Teacher not found' });

    return res.json({ message: 'Teacher updated successfully', teacher: data });
  } catch (err) {
    console.error('[PUT /teachers/:id]', err);
    return res.status(500).json({ error: 'Failed to update teacher' });
  }
});

// DELETE /api/teachers/:id — Remove teacher
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can delete teacher accounts' });
    }

    const { error } = await supabase
      .from('instructors')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Teacher deleted successfully' });
  } catch (err) {
    console.error('[DELETE /teachers]', err);
    return res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

module.exports = router;
