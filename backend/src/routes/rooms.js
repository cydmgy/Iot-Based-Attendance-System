// /api/rooms — Room management
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

// GET /api/rooms — list all rooms
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    return res.json({ rooms: data || [] });
  } catch (err) {
    console.error('[GET /rooms]', err);
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// POST /api/rooms — create a new room
router.post('/', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { name, location } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const { data, error } = await supabase
      .from('rooms')
      .insert({ name: name.trim(), location: location ? location.trim() : null })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ message: 'Room created', room: data });
  } catch (err) {
    console.error('[POST /rooms]', err);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

// PUT /api/rooms/:id — update an existing room
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { name, location } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (location !== undefined) updates.location = location ? location.trim() : null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    const { data, error } = await supabase
      .from('rooms')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Room not found' });

    return res.json({ message: 'Room updated', room: data });
  } catch (err) {
    console.error('[PUT /rooms/:id]', err);
    return res.status(500).json({ error: 'Failed to update room' });
  }
});

// DELETE /api/rooms/:id — delete a room
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Room deleted successfully' });
  } catch (err) {
    console.error('[DELETE /rooms/:id]', err);
    return res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
