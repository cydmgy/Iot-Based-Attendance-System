// /api/subjects — Subject management
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

// GET /api/subjects — list all subjects with room and instructor info
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subjects')
      .select('*, rooms(name, location), instructors(full_name, email)')
      .order('name', { ascending: true });

    if (error) throw error;
    return res.json({ subjects: data || [] });
  } catch (err) {
    console.error('[GET /subjects]', err);
    return res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// POST /api/subjects — create a new subject
router.post('/', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { name, code, room_id, instructor_id, late_threshold_minutes, min_attendance_percent, school_year } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Subject name is required' });
    }

    const { data, error } = await supabase
      .from('subjects')
      .insert({
        name: name.trim(),
        code: code ? code.trim() : null,
        room_id: room_id || null,
        instructor_id: instructor_id || null,
        late_threshold_minutes: parseInt(late_threshold_minutes, 10) || 15,
        min_attendance_percent: parseInt(min_attendance_percent, 10) || 75,
        school_year: school_year ? school_year.trim() : '2026-2027'
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ message: 'Subject created', subject: data });
  } catch (err) {
    console.error('[POST /subjects]', err);
    return res.status(500).json({ error: 'Failed to create subject' });
  }
});

// PUT /api/subjects/:id — update an existing subject
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { name, code, room_id, instructor_id, late_threshold_minutes, min_attendance_percent, school_year } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code ? code.trim() : null;
    if (room_id !== undefined) updates.room_id = room_id || null;
    if (instructor_id !== undefined) updates.instructor_id = instructor_id || null;
    if (late_threshold_minutes !== undefined) updates.late_threshold_minutes = parseInt(late_threshold_minutes, 10);
    if (min_attendance_percent !== undefined) updates.min_attendance_percent = parseInt(min_attendance_percent, 10);
    if (school_year !== undefined) updates.school_year = school_year.trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    const { data, error } = await supabase
      .from('subjects')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, rooms(name, location), instructors(full_name, email)')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Subject not found' });

    return res.json({ message: 'Subject updated', subject: data });
  } catch (err) {
    console.error('[PUT /subjects/:id]', err);
    return res.status(500).json({ error: 'Failed to update subject' });
  }
});

// DELETE /api/subjects/:id — delete a subject
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { error } = await supabase
      .from('subjects')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Subject deleted successfully' });
  } catch (err) {
    console.error('[DELETE /subjects/:id]', err);
    return res.status(500).json({ error: 'Failed to delete subject' });
  }
});

module.exports = router;
