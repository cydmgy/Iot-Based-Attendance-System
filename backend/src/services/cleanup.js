const supabase = require('../supabase');

/**
 * Automatically purges student accounts that have not had a physical RFID tag assigned
 * within 2 days of creation (i.e. their rfid_uid is still an 'AUTO-' placeholder or unassigned).
 */
async function deleteUnregisteredStudents() {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Query students registered more than 48 hours ago
    const { data: candidates, error: findErr } = await supabase
      .from('students')
      .select('id, student_id, full_name, rfid_uid, created_at')
      .lt('created_at', twoDaysAgo);

    if (findErr) {
      console.warn('[Security Cleanup] Query error:', findErr.message);
      return;
    }

    if (!candidates || candidates.length === 0) {
      return;
    }

    // Filter students where RFID is still 'AUTO-*', null, or unassigned ('-')
    const toPurge = candidates.filter(s => {
      if (!s.rfid_uid) return true;
      const uid = String(s.rfid_uid).trim().toUpperCase();
      return uid.startsWith('AUTO') || uid === '-' || uid === 'NONE' || uid === 'NULL';
    });

    if (toPurge.length > 0) {
      const ids = toPurge.map(c => c.id);
      console.log(`[Security Cleanup] Purging ${ids.length} student account(s) where RFID tag is still AUTO after 2 days.`);

      // Clean dependent rows to preserve database integrity
      await supabase.from('guardians').delete().in('student_id', ids).catch(() => null);
      await supabase.from('leave_requests').delete().in('student_id', ids).catch(() => null);
      await supabase.from('attendance_logs').delete().in('student_id', ids).catch(() => null);

      const { error: delErr } = await supabase.from('students').delete().in('id', ids);
      if (delErr) {
        console.error('[Security Cleanup] Deletion error:', delErr.message);
      } else {
        console.log(`[Security Cleanup] Successfully purged ${ids.length} student account(s) with AUTO RFID.`);
      }
    }
  } catch (err) {
    console.error('[Security Cleanup] Unexpected error:', err);
  }
}

module.exports = { deleteUnregisteredStudents };

