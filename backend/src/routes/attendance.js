// /api/attendance — attendance logs, live feed, and reports
// GET /api/attendance           — attendance logs list (supports section, room_id, limit, student filter)
// GET /api/attendance/live      — today's logs for a specific room (live dashboard feed)
// GET /api/attendance/daily     — daily summary & report
// GET /api/attendance/weekly    — weekly report with per-student stats
// GET /api/attendance/monthly   — monthly report
// GET /api/attendance/absentees — students below threshold

const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

// Helper to get today's date in local system timezone (Asia/Manila, UTC+8 by default)
function getLocalDateStr(date = new Date()) {
  const tz = process.env.SYSTEM_TIMEZONE || 'Asia/Manila';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

// ── GET /api/attendance ──────────────────────────────────────────
// Returns attendance logs (optional room_id, section, student_id filter, limit)
router.get('/', auth, async (req, res) => {
  try {
    const { room_id, limit = 100, section, student_id } = req.query;

    const selectClause = section
      ? `
        id, rfid_uid, timestamp, status, device_id,
        students!inner(id, full_name, student_id, course, year_level, section),
        rooms(id, name, location)
      `
      : `
        id, rfid_uid, timestamp, status, device_id,
        students(id, full_name, student_id, course, year_level, section),
        rooms(id, name, location)
      `;

    let query = supabase
      .from('attendance_logs')
      .select(selectClause)
      .order('timestamp', { ascending: false })
      .limit(Math.min(parseInt(limit, 10) || 100, 500));

    // If caller is student, strictly limit to their own logs
    if (req.user?.role === 'student') {
      const currentStudentId = req.user.id || req.user.student_id;
      query = query.eq('student_id', currentStudentId);
    } else if (student_id) {
      query = query.eq('student_id', student_id);
    }

    if (room_id) {
      query = query.eq('room_id', room_id);
    }
    if (section) {
      query = query.eq('students.section', section);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ logs: data || [], count: data ? data.length : 0 });
  } catch (err) {
    console.error('[GET /attendance]', err);
    return res.status(500).json({ error: 'Failed to fetch attendance logs' });
  }
});

// ── GET /api/attendance/live?room_id=xxx ─────────────────────────
// Returns today's attendance logs for a room (used by live dashboard)
router.get('/live', auth, async (req, res) => {
  try {
    const { room_id } = req.query;
    if (!room_id) return res.status(400).json({ error: 'room_id is required' });

    // Local timezone start of day in ISO
    const todayStr = getLocalDateStr();
    const startOfDay = new Date(`${todayStr}T00:00:00+08:00`).toISOString();

    const { data, error } = await supabase
      .from('attendance_logs')
      .select(`
        id, rfid_uid, timestamp, status, device_id,
        students(id, full_name, student_id, course, year_level, section),
        rooms(id, name)
      `)
      .eq('room_id', room_id)
      .gte('timestamp', startOfDay)
      .order('timestamp', { ascending: false });

    if (error) throw error;

    return res.json({ logs: data || [], count: data ? data.length : 0 });
  } catch (err) {
    console.error('[GET /attendance/live]', err);
    return res.status(500).json({ error: 'Failed to fetch live attendance' });
  }
});

// ── GET /api/attendance/daily?date=YYYY-MM-DD&room_id=xxx&section=xxx ────────
router.get('/daily', auth, async (req, res) => {
  try {
    const dateStr = req.query.date || getLocalDateStr();
    const { room_id, section } = req.query;

    const startOfDay = new Date(`${dateStr}T00:00:00+08:00`).toISOString();
    const endOfDay   = new Date(`${dateStr}T23:59:59+08:00`).toISOString();

    const selectClause = section
      ? `
        id, rfid_uid, timestamp, status,
        students!inner(id, full_name, student_id, section),
        rooms(id, name)
      `
      : `
        id, rfid_uid, timestamp, status,
        students(id, full_name, student_id, section),
        rooms(id, name)
      `;

    let query = supabase
      .from('attendance_logs')
      .select(selectClause)
      .gte('timestamp', startOfDay)
      .lte('timestamp', endOfDay)
      .order('timestamp', { ascending: false });

    if (room_id) query = query.eq('room_id', room_id);
    if (section) query = query.eq('students.section', section);

    // If caller is student, limit to student
    if (req.user?.role === 'student') {
      const currentStudentId = req.user.id || req.user.student_id;
      query = query.eq('student_id', currentStudentId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const logs = data || [];

    // Get total enrolled students count for ratio
    let enrolledQuery = supabase
      .from('students')
      .select('*', { count: 'exact', head: true });
    if (section) {
      enrolledQuery = enrolledQuery.eq('section', section);
    }

    const { count: totalEnrolled } = await enrolledQuery;

    const enrolled = totalEnrolled || 0;
    const present = logs.filter(l => l.status === 'present').length;
    const late = logs.filter(l => l.status === 'late').length;
    const excused = logs.filter(l => l.status === 'excused').length;
    const explicitlyAbsent = logs.filter(l => l.status === 'absent').length;
    const unscanned = Math.max(0, enrolled - (present + late + excused + explicitlyAbsent));
    const totalAbsent = explicitlyAbsent + unscanned;
    const attendanceRate = enrolled > 0 ? Math.round(((present + late) / enrolled) * 100) : 0;

    const summary = {
      section: section || 'all',
      enrolled,
      present,
      late,
      excused,
      explicitly_absent: explicitlyAbsent,
      absent: totalAbsent,
      unknown: logs.filter(l => l.status === 'unknown').length,
      total_scans: logs.length,
      attendance_rate: attendanceRate,
    };

    return res.json({ date: dateStr, section: section || null, summary, logs });
  } catch (err) {
    console.error('[GET /attendance/daily]', err);
    return res.status(500).json({ error: 'Failed to fetch daily report' });
  }
});

// ── GET /api/attendance/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD&subject_id=xxx ──
router.get('/weekly', auth, async (req, res) => {
  try {
    const { from, to, subject_id, room_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date params are required (format: YYYY-MM-DD)' });
    }

    const fromIso = new Date(`${from}T00:00:00+08:00`).toISOString();
    const toIso   = new Date(`${to}T23:59:59+08:00`).toISOString();

    let query = supabase
      .from('attendance_logs')
      .select(`
        id, student_id, timestamp, status,
        students(id, full_name, student_id, section)
      `)
      .gte('timestamp', fromIso)
      .lte('timestamp', toIso)
      .neq('status', 'unknown');

    if (room_id) query = query.eq('room_id', room_id);

    // Apply subject filter via enrolled students in schedules
    if (subject_id) {
      const { data: scheds } = await supabase
        .from('schedules')
        .select('student_id')
        .eq('subject_id', subject_id);

      const enrolledStudentIds = (scheds || []).map(s => s.student_id).filter(Boolean);
      if (enrolledStudentIds.length > 0) {
        query = query.in('student_id', enrolledStudentIds);
      } else {
        // No students enrolled in this subject yet
        return res.json({ from, to, school_days: 0, report: [] });
      }
    }

    if (req.user?.role === 'student') {
      const currentStudentId = req.user.id || req.user.student_id;
      query = query.eq('student_id', currentStudentId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Calculate unique school days (Mon–Fri) in the range
    const fromDate = new Date(from);
    const toDate = new Date(to);
    let schoolDays = 0;
    const d = new Date(fromDate);
    while (d <= toDate) {
      const day = d.getDay();
      if (day >= 1 && day <= 5) schoolDays++; // Mon-Fri
      d.setDate(d.getDate() + 1);
    }

    // Aggregate per student
    const studentMap = {};
    for (const log of (data || [])) {
      if (!log.student_id) continue;
      const id = log.student_id;
      if (!studentMap[id]) {
        studentMap[id] = {
          student: log.students,
          present: 0,
          late: 0,
          excused: 0,
        };
      }
      studentMap[id][log.status]++;
    }

    // Compute attendance percentage
    const report = Object.values(studentMap).map(s => ({
      ...s,
      total_logged: s.present + s.late + s.excused,
      attendance_percent: schoolDays > 0
        ? Math.round(((s.present + s.late + s.excused) / schoolDays) * 100)
        : 0,
    }));

    return res.json({ from, to, school_days: schoolDays, report });
  } catch (err) {
    console.error('[GET /attendance/weekly]', err);
    return res.status(500).json({ error: 'Failed to fetch weekly report' });
  }
});

// ── GET /api/attendance/monthly?year=2026&month=10&room_id=xxx ───
router.get('/monthly', auth, async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear(), 10);
    const month = parseInt(req.query.month || (new Date().getMonth() + 1), 10);
    const { room_id } = req.query;

    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const fromIso = new Date(`${from}T00:00:00+08:00`).toISOString();
    const toIso   = new Date(`${to}T23:59:59+08:00`).toISOString();

    let query = supabase
      .from('attendance_logs')
      .select('student_id, timestamp, status, students(full_name, student_id)')
      .gte('timestamp', fromIso)
      .lte('timestamp', toIso)
      .neq('status', 'unknown');

    if (room_id) query = query.eq('room_id', room_id);

    if (req.user?.role === 'student') {
      const currentStudentId = req.user.id || req.user.student_id;
      query = query.eq('student_id', currentStudentId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate per student per day
    const byStudent = {};
    for (const log of (data || [])) {
      if (!log.student_id) continue;
      const sid = log.student_id;
      const day = new Date(log.timestamp).getDate();
      if (!byStudent[sid]) {
        byStudent[sid] = { student: log.students, days: {} };
      }
      byStudent[sid].days[day] = log.status;
    }

    return res.json({ year, month, report: Object.values(byStudent) });
  } catch (err) {
    console.error('[GET /attendance/monthly]', err);
    return res.status(500).json({ error: 'Failed to fetch monthly report' });
  }
});

// ── GET /api/attendance/absentees?subject_id=xxx&threshold=75 ────
// Returns students whose attendance % falls below the threshold
router.get('/absentees', auth, async (req, res) => {
  try {
    const { subject_id, threshold = 75 } = req.query;

    // Get the subject details including its own threshold if not overridden
    let subjectThreshold = parseInt(threshold, 10) || 75;
    let enrolledStudentIds = null;

    if (subject_id) {
      const { data: subject } = await supabase
        .from('subjects')
        .select('min_attendance_percent, school_year')
        .eq('id', subject_id)
        .maybeSingle();

      if (subject && subject.min_attendance_percent) {
        subjectThreshold = subject.min_attendance_percent;
      }

      // Look up students enrolled in this specific subject
      const { data: scheds } = await supabase
        .from('schedules')
        .select('student_id')
        .eq('subject_id', subject_id);

      enrolledStudentIds = (scheds || []).map(s => s.student_id).filter(Boolean);
    }

    // Fetch all logs for the last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceIso = since.toISOString();

    let query = supabase
      .from('attendance_logs')
      .select('student_id, status, students(id, full_name, student_id, section)')
      .gte('timestamp', sinceIso)
      .neq('status', 'unknown');

    // Filter by enrolled student IDs if subject_id was provided
    if (enrolledStudentIds !== null) {
      if (enrolledStudentIds.length === 0) {
        return res.json({ threshold: subjectThreshold, absentees: [] });
      }
      query = query.in('student_id', enrolledStudentIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Calculate actual Mon–Fri school days in the last 30-day window
    let schoolDays = 0;
    const cur = new Date(since);
    const today = new Date();
    while (cur <= today) {
      const day = cur.getDay();
      if (day >= 1 && day <= 5) schoolDays++;
      cur.setDate(cur.getDate() + 1);
    }
    const totalDays = schoolDays > 0 ? schoolDays : 22;

    // Compute per-student stats
    const stats = {};
    for (const log of (data || [])) {
      if (!log.student_id) continue;
      const sid = log.student_id;
      if (!stats[sid]) stats[sid] = { student: log.students, present: 0, late: 0, excused: 0 };
      stats[sid][log.status]++;
    }

    const absentees = Object.values(stats)
      .map(s => {
        const attended = s.present + s.late + s.excused;
        return {
          ...s.student,
          total_attended: attended,
          total_days: totalDays,
          attendance_percent: Math.round((attended / totalDays) * 100),
        };
      })
      .filter(s => s.attendance_percent < subjectThreshold)
      .sort((a, b) => a.attendance_percent - b.attendance_percent);

    return res.json({ threshold: subjectThreshold, school_days: totalDays, absentees });
  } catch (err) {
    console.error('[GET /attendance/absentees]', err);
    return res.status(500).json({ error: 'Failed to fetch absentees' });
  }
});

module.exports = router;
