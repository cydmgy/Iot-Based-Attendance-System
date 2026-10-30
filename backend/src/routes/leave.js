// /api/leave — Leave / Excuse Request management
// POST  /api/leave          — File a new leave request (student or admin)
// GET   /api/leave          — List leave requests (filterable by status)
// PATCH /api/leave/:id      — Approve or reject a request (instructor or admin)

const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

// POST /api/leave — file a leave request
router.post('/', auth, async (req, res) => {
  try {
    let { student_id, subject_id, leave_date, reason } = req.body;

    // If logged in as student, bind student_id to authenticated student
    if (req.user?.role === 'student') {
      student_id = req.user.id || req.user.student_id;
    }

    if (!student_id || !subject_id || !leave_date || !reason) {
      return res.status(400).json({
        error: 'student_id, subject_id, leave_date, and reason are all required'
      });
    }

    // Validate that leave_date is formatted as YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leave_date)) {
      return res.status(400).json({ error: 'leave_date must be in YYYY-MM-DD format' });
    }

    // Validate that leave_date is not in the past (using Philippine local time UTC+8)
    const now = new Date();
    const tz = process.env.SYSTEM_TIMEZONE || 'Asia/Manila';
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

    if (leave_date < todayStr) {
      return res.status(400).json({
        error: 'Absence date cannot be before today'
      });
    }

    // Prevent duplicate requests for the same student + subject + date
    const { data: existing } = await supabase
      .from('leave_requests')
      .select('id, status')
      .eq('student_id', student_id)
      .eq('subject_id', subject_id)
      .eq('leave_date', leave_date)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: `A leave request already exists for this date (status: ${existing.status})`,
        existing_id: existing.id
      });
    }

    const { data, error } = await supabase
      .from('leave_requests')
      .insert({ student_id, subject_id, leave_date, reason: reason.trim(), status: 'pending' })
      .select(`
        id, leave_date, reason, status, created_at,
        students(full_name, student_id),
        subjects(name, code)
      `)
      .single();

    if (error) throw error;

    return res.status(201).json({ leave_request: data });
  } catch (err) {
    console.error('[POST /leave]', err);
    return res.status(500).json({ error: 'Failed to file leave request' });
  }
});

// GET /api/leave?status=pending&subject_id=xxx — list leave requests
router.get('/', auth, async (req, res) => {
  try {
    const { status, subject_id, student_id } = req.query;

    let query = supabase
      .from('leave_requests')
      .select(`
        id, leave_date, reason, status, created_at, reviewed_at,
        students(id, full_name, student_id, section),
        subjects(id, name, code),
        reviewed_by:instructors(id, full_name, email)
      `)
      .order('created_at', { ascending: false });

    // Restrict student callers to only their own leave requests
    if (req.user?.role === 'student') {
      const currentStudentId = req.user.id || req.user.student_id;
      query = query.eq('student_id', currentStudentId);
    } else if (student_id) {
      query = query.eq('student_id', student_id);
    }

    if (status)     query = query.eq('status', status);
    if (subject_id) query = query.eq('subject_id', subject_id);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ leave_requests: data || [], count: data ? data.length : 0 });
  } catch (err) {
    console.error('[GET /leave]', err);
    return res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

// PATCH /api/leave/:id — approve or reject a leave request
// Body: { action: "approved" | "rejected" }
router.patch('/:id', auth, async (req, res) => {
  try {
    const action = req.body.action || req.body.status;

    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approved" or "rejected"' });
    }

    // Resolve instructor / reviewer record
    const targetId = req.user?.instructor_id || req.user?.id;
    let instructor = null;

    if (targetId) {
      const { data } = await supabase
        .from('instructors')
        .select('id, full_name, role')
        .or(`id.eq.${targetId},auth_id.eq.${targetId}`)
        .maybeSingle();
      instructor = data;
    }

    // Role verification
    if (!instructor && req.user?.role !== 'admin' && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Only instructors or administrators can review leave requests' });
    }

    // Fetch the leave request
    const { data: leave, error: fetchError } = await supabase
      .from('leave_requests')
      .select('id, student_id, subject_id, leave_date, status')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !leave) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    if (leave.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${leave.status}` });
    }

    // Update the leave request status
    const reviewerId = instructor ? instructor.id : null;
    const { error: updateError } = await supabase
      .from('leave_requests')
      .update({
        status: action,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (updateError) throw updateError;

    // If APPROVED — update or create corresponding attendance log as "excused"
    if (action === 'approved') {
      const leaveStart = new Date(leave.leave_date + 'T00:00:00+08:00').toISOString();
      const leaveEnd   = new Date(leave.leave_date + 'T23:59:59+08:00').toISOString();

      // Check if an attendance log exists for this student on this date
      const { data: existingLog } = await supabase
        .from('attendance_logs')
        .select('id, status')
        .eq('student_id', leave.student_id)
        .gte('timestamp', leaveStart)
        .lte('timestamp', leaveEnd)
        .maybeSingle();

      if (existingLog) {
        // Update existing log to "excused"
        await supabase
          .from('attendance_logs')
          .update({ status: 'excused' })
          .eq('id', existingLog.id);

        // Write to audit override log
        await supabase.from('attendance_overrides').insert({
          attendance_log_id: existingLog.id,
          changed_by: reviewerId,
          old_status: existingLog.status,
          new_status: 'excused',
          reason: 'Leave request approved',
        });
      } else {
        // No scan exists yet — look up actual student RFID rather than hardcoded MANUAL_ENTRY
        const { data: studentRecord } = await supabase
          .from('students')
          .select('rfid_uid')
          .eq('id', leave.student_id)
          .maybeSingle();

        const studentRfid = studentRecord?.rfid_uid || 'EXCUSED_LEAVE';

        await supabase.from('attendance_logs').insert({
          student_id: leave.student_id,
          rfid_uid: studentRfid,
          timestamp: new Date(leave.leave_date + 'T08:00:00+08:00').toISOString(),
          status: 'excused',
          device_id: 'SYSTEM',
        });
      }
    }

    return res.json({
      success: true,
      message: `Leave request ${action}`,
      action,
    });

  } catch (err) {
    console.error('[PATCH /leave/:id]', err);
    return res.status(500).json({ error: 'Failed to process leave request' });
  }
});

module.exports = router;
