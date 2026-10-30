// POST /api/scan
// Called by the ESP32 every time a student taps their RFID card
// Handles: duplicate guard, student lookup, schedule matching, and late checking

const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const iotAuth = require('../middleware/iotAuth');
const auth = require('../middleware/auth');

// In-memory buffer of the latest card tapped (used by Admin "Tap to Enroll")
let latestScan = null;

// GET /api/scan/latest-tap — Polled by admin UI during "Tap to Enroll"
router.get('/latest-tap', auth, (req, res) => {
  res.json({ scan: latestScan });
});

// POST /api/scan/clear-tap — Clears the tap buffer
router.post('/clear-tap', auth, (req, res) => {
  latestScan = null;
  res.json({ success: true });
});

router.post('/', iotAuth, async (req, res) => {
  const { uid, room_id, device_id } = req.body;

  // ── Validate input ──────────────────────────────────────────
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid required field: uid' });
  }

  // Sanitize UID: only allow hex characters for standard RFID cards
  const cleanHex = uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!cleanHex) {
    return res.status(400).json({ error: 'RFID UID contains no valid alphanumeric characters' });
  }

  const colonUid = cleanHex.match(/.{1,2}/g)?.join(':') || cleanHex;
  const spaceUid = cleanHex.match(/.{1,2}/g)?.join(' ') || cleanHex;

  // Build safe sanitized variants for PostgREST .or() query
  const safeVariants = [cleanHex, colonUid, spaceUid];
  const orFilter = safeVariants.map(v => `rfid_uid.eq.${v}`).join(',');

  const guardMinutes = parseInt(process.env.DUPLICATE_GUARD_MINUTES || '5', 10);
  const guardCutoff = new Date(Date.now() - guardMinutes * 60 * 1000).toISOString();

  try {
    // ── Auto-resolve Room ID if not sent by ESP32 ─────────────
    let targetRoomId = room_id;
    if (!targetRoomId) {
      const { data: defaultRoom } = await supabase
        .from('rooms')
        .select('id')
        .order('name', { ascending: true })
        .limit(1)
        .maybeSingle();
      targetRoomId = defaultRoom ? defaultRoom.id : null;
    }

    // ── STEP 1: Duplicate Scan Guard ─────────────────────────
    let dupQuery = supabase
      .from('attendance_logs')
      .select('id, timestamp')
      .or(orFilter)
      .gte('timestamp', guardCutoff)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (targetRoomId) {
      dupQuery = dupQuery.eq('room_id', targetRoomId);
    }

    const { data: recentScan } = await dupQuery.maybeSingle();

    if (recentScan) {
      return res.status(409).json({
        message: 'Duplicate scan — already logged recently',
        last_scan: recentScan.timestamp,
      });
    }

    // ── STEP 2: Look up student by RFID UID variants ────────
    const { data: student } = await supabase
      .from('students')
      .select('id, full_name, student_id, section')
      .or(orFilter)
      .maybeSingle();

    // Update latest card tapped buffer (for Tap to Enroll)
    latestScan = {
      uid: cleanHex,
      formatted: colonUid,
      raw: uid,
      isRegistered: !!student,
      studentName: student ? student.full_name : null,
      timestamp: Date.now()
    };

    // ── STEP 3: Determine attendance status ─────────────────
    let status = 'unknown';
    let studentId = null;

    if (student) {
      studentId = student.id;
      status = 'present'; // default

      // Timezone-aware date resolution (Asia/Manila UTC+8 by default)
      const now = new Date();
      const tz = process.env.SYSTEM_TIMEZONE || 'Asia/Manila';
      const phTimeStr = now.toLocaleString('en-US', { timeZone: tz });
      const localDate = new Date(phTimeStr);

      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const todayName = days[localDate.getDay()];
      const nowHour = localDate.getHours();
      const nowMinute = localDate.getMinutes();
      const nowMinutes = nowHour * 60 + nowMinute;

      // Find all matching schedules for this student today
      const { data: todaySchedules, error: schedError } = await supabase
        .from('schedules')
        .select(`
          start_time, end_time, subject_id,
          subjects(id, name, late_threshold_minutes, room_id)
        `)
        .eq('student_id', student.id)
        .eq('day_of_week', todayName);

      if (!schedError && todaySchedules && todaySchedules.length > 0) {
        // Find best matching schedule:
        // Priority 1: Match by room
        let matchedSchedule = null;
        if (targetRoomId) {
          matchedSchedule = todaySchedules.find(s => s.subjects?.room_id === targetRoomId);
        }

        // Priority 2: Match by time proximity
        if (!matchedSchedule) {
          let minDiff = Infinity;
          for (const s of todaySchedules) {
            if (!s.start_time) continue;
            const [sh, sm] = s.start_time.split(':').map(Number);
            const schedStartMinutes = sh * 60 + sm;
            const diff = Math.abs(nowMinutes - schedStartMinutes);
            if (diff < minDiff) {
              minDiff = diff;
              matchedSchedule = s;
            }
          }
        }

        // Late evaluation
        if (matchedSchedule && matchedSchedule.start_time) {
          const threshold = matchedSchedule.subjects?.late_threshold_minutes ?? 15;
          const [sh, sm] = matchedSchedule.start_time.split(':').map(Number);
          const schedStartMinutes = sh * 60 + sm;
          const lateAfterMinutes = schedStartMinutes + threshold;

          if (nowMinutes > lateAfterMinutes) {
            status = 'late';
          }
        }
      }
    }

    // ── STEP 4: Insert attendance log ────────────────────────
    const { data: log, error: insertError } = await supabase
      .from('attendance_logs')
      .insert({
        student_id: studentId,
        room_id: targetRoomId,
        rfid_uid: colonUid, // Store normalized colon format
        status,
        device_id: device_id || 'ESP32-NODE-01',
        timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // ── STEP 5: Respond to ESP32 ─────────────────────────────
    return res.status(200).json({
      success: true,
      student_name: student ? student.full_name : null,
      status,
      log_id: log.id,
    });

  } catch (err) {
    console.error('[SCAN ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
