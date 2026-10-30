const supabase = require('../supabase');

/**
 * Automatically purges student accounts that have not registered an RFID tag
 * within 2 days of creation for security purposes.
 */
async function deleteUnregisteredStudents() {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Query students without a valid RFID card who registered over 48 hours ago
    const { data: candidates, error: findErr } = await supabase
      .from('students')
      .select('id, student_id, full_name, rfid_uid, created_at')
      .or('rfid_uid.is.null,rfid_uid.eq.-,rfid_uid.like.AUTO-%')
      .lt('created_at', twoDaysAgo);

    if (findErr) {
      console.warn('[Security Cleanup] Query error:', findErr.message);
      return;
    }

    if (candidates && candidates.length > 0) {
      const ids = candidates.map(c => c.id);
      console.log(`[Security Cleanup] Purging ${ids.length} student accounts missing RFID tag > 2 days.`);

      // Clean dependent rows to preserve integrity
      await supabase.from('guardians').delete().in('student_id', ids).catch(() => null);
      await supabase.from('leave_requests').delete().in('student_id', ids).catch(() => null);
      await supabase.from('attendance_logs').delete().in('student_id', ids).catch(() => null);

      const { error: delErr } = await supabase.from('students').delete().in('id', ids);
      if (delErr) {
        console.error('[Security Cleanup] Deletion error:', delErr.message);
      } else {
        console.log(`[Security Cleanup] Successfully purged ${ids.length} unassigned student account(s).`);
      }
    }
  } catch (err) {
    console.error('[Security Cleanup] Unexpected error:', err);
  }
}

module.exports = { deleteUnregisteredStudents };

