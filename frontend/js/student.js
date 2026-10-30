// ============================================================
// STUDENT PORTAL CONTROLLER (Figma Screens 12, 13, 14)
// Student Dashboard, Attendance History Ledger, File Excuse / Leave
// ============================================================

function initStudentPortal() {
  const today = new Date().toISOString().split('T')[0];
  const stdLeaveDateEl = document.getElementById('std-leave-date');
  if (stdLeaveDateEl) {
    stdLeaveDateEl.value = today;
    stdLeaveDateEl.min = today;
  }

  const todayDateBadge = document.getElementById('student-today-date');
  if (todayDateBadge) {
    todayDateBadge.textContent = `Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  populateStudentSubjectDropdowns();
  showStudentTab('overview');
  loadStudentPortalData();
}

function populateStudentSubjectDropdowns() {
  const filterSubj = document.getElementById('std-filter-subject');
  const leaveSubj = document.getElementById('std-leave-subject');

  const subjList = (subjects && subjects.length > 0)
    ? subjects
    : [
        { name: 'Mathematics' },
        { name: 'Science' },
        { name: 'English' },
        { name: 'Filipino' },
        { name: 'Araling Panlipunan' }
      ];

  if (filterSubj) {
    filterSubj.innerHTML = '<option value="">All subjects</option>' +
      subjList.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  }

  if (leaveSubj) {
    leaveSubj.innerHTML = subjList.map((s, idx) =>
      `<option value="${escapeHtml(s.name)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');
  }
}

// ── Student Tabs ──────────────────────────────────────────────

function showStudentTab(tab) {
  const tabs = ['overview', 'logs', 'leave'];
  tabs.forEach(t => {
    document.getElementById(`std-tab-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tablink-std-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`sidebar-std-${t}`)?.classList.toggle('active', t === tab);
  });

  const sidebarTitle = document.getElementById('student-sidebar-title');
  const sidebarDesc = document.getElementById('student-sidebar-desc');
  const brandTitle = document.getElementById('student-brand-title');
  const mobileTitle = document.getElementById('student-mobile-header-title');
  const welcomeDesc = document.getElementById('student-welcome-desc');

  if (tab === 'overview') {
    if (sidebarTitle) sidebarTitle.textContent = 'Overview';
    if (sidebarDesc) sidebarDesc.textContent = 'Track attendance, review history, and submit leave requests.';
    if (brandTitle) brandTitle.textContent = 'Student Dashboard';
    if (mobileTitle) mobileTitle.textContent = 'Dashboard';
    if (welcomeDesc) welcomeDesc.textContent = 'Track your attendance, upcoming classes, and leave status.';
    loadStudentPortalData();
  } else if (tab === 'logs') {
    if (sidebarTitle) sidebarTitle.textContent = 'Attendance History';
    if (sidebarDesc) sidebarDesc.textContent = 'Review all personal attendance records with date, time, room, status, and teacher.';
    if (brandTitle) brandTitle.textContent = 'Attendance History';
    if (mobileTitle) mobileTitle.textContent = 'Attendance History';
    if (welcomeDesc) welcomeDesc.textContent = 'Review all personal attendance records with date, time, room, status, and teacher.';
    loadStudentPortalData();
  } else if (tab === 'leave') {
    if (sidebarTitle) sidebarTitle.textContent = 'File Excuse / Leave';
    if (sidebarDesc) sidebarDesc.textContent = 'Submit leave requests, attach proof, and review past request status.';
    if (brandTitle) brandTitle.textContent = 'File Excuse / Leave';
    if (mobileTitle) mobileTitle.textContent = 'File Excuse / Leave';
    if (welcomeDesc) welcomeDesc.textContent = 'Submit an absence request and track its review status.';
    loadStudentLeaveHistory();
  }
}

// ── Tab 1: Dashboard Overview & Tab 2: Logs Ledger ───────────

async function loadStudentPortalData() {
  const displayName = studentUser.full_name || studentUser.name || 'Student';
  const displaySection = studentUser.section || '—';
  const displayLrn = studentUser.student_id || '—';
  const displayRfid = studentUser.rfid_uid || studentUser.rfid || '—';
  const initials = displayName.charAt(0).toUpperCase();

  // Populate UI Profile fields
  const navNameEl = document.getElementById('student-nav-name');
  const avatarEl = document.getElementById('student-avatar');
  const avatarBigEl = document.getElementById('student-avatar-big');
  const cardNameEl = document.getElementById('std-card-name');
  const detailNameEl = document.getElementById('std-detail-name');
  const cardIdEl = document.getElementById('std-card-id');
  const cardCourseEl = document.getElementById('std-card-course');
  const cardRfidEl = document.getElementById('std-card-rfid');
  const greetingEl = document.getElementById('student-greeting');

  const sidebarUserName = document.getElementById('student-sidebar-user-name');
  const sidebarUserLrn = document.getElementById('student-sidebar-user-lrn');

  if (navNameEl) navNameEl.textContent = displayName;
  if (avatarEl) avatarEl.textContent = initials;
  if (avatarBigEl) avatarBigEl.textContent = initials;
  if (sidebarUserName) sidebarUserName.textContent = displayName;
  if (sidebarUserLrn) sidebarUserLrn.textContent = `LRN: ${displayLrn}`;
  if (cardNameEl) cardNameEl.textContent = displayName;
  if (detailNameEl) detailNameEl.textContent = displayName;
  if (cardIdEl) cardIdEl.textContent = displayLrn;
  if (cardCourseEl) cardCourseEl.textContent = displaySection;
  if (cardRfidEl) cardRfidEl.textContent = displayRfid;
  if (greetingEl) greetingEl.textContent = `Good morning, ${displayName}!`;

  // Prefill Tab 3 form fields
  const formLrn = document.getElementById('leave-form-lrn');
  const formName = document.getElementById('leave-form-name');
  if (formLrn) formLrn.value = displayLrn;
  if (formName) formName.value = displayName;

  try {
    const res = await axios.get(`${API_BASE}/api/attendance`);
    allLogs = res.data.logs || [];

    // Filter logs for this student
    const studentLogs = allLogs.filter(l => 
      (l.students && (l.students.id === studentUser.id || l.students.student_id === studentUser.student_id)) ||
      (l.student_id && l.student_id === studentUser.id) ||
      (l.rfid_uid && l.rfid_uid === studentUser.rfid)
    );

    const presentCount = studentLogs.filter(l => l.status === 'present').length;
    const lateCount = studentLogs.filter(l => l.status === 'late').length;
    const absentCount = studentLogs.filter(l => l.status === 'absent' || l.status === 'excused').length;
    const totalDays = studentLogs.length;

    const ratePercent = totalDays > 0 ? Math.round(((presentCount + lateCount * 0.75) / totalDays) * 100) : 0;

    // Tab 1 KPI Cards
    const presentEl = document.getElementById('std-stat-present');
    const ontimeEl = document.getElementById('std-stat-ontime');
    const absentEl = document.getElementById('std-stat-absent');
    const rateEl = document.getElementById('std-stat-rate');

    if (presentEl) presentEl.textContent = totalDays;
    if (ontimeEl) ontimeEl.textContent = presentCount;
    if (absentEl) absentEl.textContent = absentCount;
    if (rateEl) rateEl.textContent = `${ratePercent}%`;

    const presentSubEl = document.getElementById('std-stat-present-sub');
    if (presentSubEl) presentSubEl.textContent = `${totalDays} day${totalDays === 1 ? '' : 's'} recorded this term`;

    const ontimeSubEl = document.getElementById('std-stat-ontime-sub');
    if (ontimeSubEl) {
      const ontimeRate = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 0;
      ontimeSubEl.textContent = `${ontimeRate}% of taps were on schedule`;
    }

    const absentSubEl = document.getElementById('std-stat-absent-sub');
    if (absentSubEl) absentSubEl.textContent = `${absentCount} school day${absentCount === 1 ? '' : 's'} missed`;

    const rateSubEl = document.getElementById('std-stat-rate-sub');
    if (rateSubEl) {
      rateSubEl.textContent = totalDays > 0 ? `${presentCount} of ${totalDays} school day${totalDays === 1 ? '' : 's'} attended` : 'No days recorded yet';
    }

    // Tab 2 KPI Cards
    const logsTotalEl = document.getElementById('std-logs-total-count');
    const logsPresentEl = document.getElementById('std-logs-present-count');
    const logsTeachersEl = document.getElementById('std-logs-teachers-count');

    const distinctRooms = new Set(studentLogs.map(l => l.room_id || l.rooms?.name).filter(Boolean));

    if (logsTotalEl) logsTotalEl.textContent = totalDays;
    if (logsPresentEl) logsPresentEl.textContent = presentCount;
    if (logsTeachersEl) logsTeachersEl.textContent = distinctRooms.size;

    const logsTotalSubEl = document.getElementById('std-logs-total-sub');
    if (logsTotalSubEl) logsTotalSubEl.textContent = `${totalDays} record${totalDays === 1 ? '' : 's'} logged`;

    const logsPresentSubEl = document.getElementById('std-logs-present-sub');
    if (logsPresentSubEl) logsPresentSubEl.textContent = `${ratePercent}% attendance rate`;

    const logsTeachersSubEl = document.getElementById('std-logs-teachers-sub');
    if (logsTeachersSubEl) logsTeachersSubEl.textContent = `${distinctRooms.size} room${distinctRooms.size === 1 ? '' : 's'} recorded`;

    // Tab 1 Recent 5 Scans Table (Figma Screen 12)
    const recentTbody = document.getElementById('std-recent-tbody');
    const historyPill = document.getElementById('std-history-pill');
    const displayRecent = studentLogs.length > 0 ? studentLogs.slice(0, 5) : allLogs.slice(0, 5);

    if (historyPill) historyPill.textContent = `${displayRecent.length} records`;

    if (recentTbody) {
      if (displayRecent.length === 0) {
        recentTbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No attendance events recorded yet.</td></tr>`;
      } else {
        recentTbody.innerHTML = displayRecent.map(l => {
          const room = l.rooms?.name || '—';
          const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const date = new Date(l.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
          const badge = getStudentStatusBadge(l.status);

          return `
            <tr>
              <td><span class="fw-medium text-dark">${date}</span></td>
              <td><span class="small text-muted">${escapeHtml(room)}</span></td>
              <td><span class="small text-dark">${time}</span></td>
              <td>${badge}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // Tab 2 Complete Attendance History Table (Figma Screen 13)
    const allTbody = document.getElementById('std-all-logs-tbody');
    const allLogsPill = document.getElementById('std-all-logs-count-pill');
    const displayAll = studentLogs.length > 0 ? studentLogs : allLogs;

    if (allLogsPill) allLogsPill.textContent = `${displayAll.length} records`;

    if (allTbody) {
      if (displayAll.length === 0) {
        allTbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No attendance history found.</td></tr>`;
      } else {
        allTbody.innerHTML = displayAll.map(l => {
          const room = l.rooms?.name || '—';
          const dateTime = new Date(l.timestamp).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          const badge = getStudentStatusBadge(l.status);
          const teacher = l.rooms?.instructors?.full_name || l.instructors?.full_name || 'Faculty';

          return `
            <tr>
              <td><strong class="text-dark">${dateTime}</strong></td>
              <td><span class="small text-muted">${escapeHtml(room)}</span></td>
              <td>${badge}</td>
              <td><span class="small text-dark fw-medium">${escapeHtml(teacher)}</span></td>
            </tr>
          `;
        }).join('');
      }
    }

  } catch (err) {
    console.error('Error fetching student portal data:', err);
  }
}

// ── Tab 3: File Excuse or Leave (Figma Screen 14) ─────────────

async function submitStudentLeave(e) {
  e.preventDefault();
  const alertEl = document.getElementById('std-leave-form-alert');
  const btn = document.getElementById('std-leave-btn');

  const subject = document.getElementById('std-leave-subject')?.value;
  const leaveDate = document.getElementById('std-leave-date')?.value;
  const reasonText = document.getElementById('std-leave-reason')?.value.trim();
  const proof = document.getElementById('std-leave-proof')?.value.trim();

  const today = new Date().toISOString().split('T')[0];
  if (!leaveDate || leaveDate < today) {
    if (alertEl) {
      alertEl.innerHTML = `<div class="alert alert-danger py-2 small mb-3"><i class="fas fa-circle-exclamation me-1"></i> Absence date cannot be in the past. Please select today or a future date.</div>`;
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Submitting...';
  }

  try {
    await axios.post(`${API_BASE}/api/leave`, {
      student_id: studentUser.id || 'std-demo-01',
      subject_id: null,
      leave_date: leaveDate,
      reason: `[${subject}] ${reasonText} (Proof: ${proof || 'None'})`
    });

    notify('student', 'Leave request submitted successfully!', 'success');
    document.getElementById('std-leave-form')?.reset();

    const stdLeaveDateEl = document.getElementById('std-leave-date');
    if (stdLeaveDateEl) {
      stdLeaveDateEl.value = today;
      stdLeaveDateEl.min = today;
    }

    await loadStudentLeaveHistory();
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Failed to file leave request';
    if (alertEl) {
      alertEl.innerHTML = `<div class="alert alert-danger py-2 small mb-3">${escapeHtml(msg)}</div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Submit request</span>';
    }
  }
}

async function loadStudentLeaveHistory() {
  const tbody = document.getElementById('std-leave-history-tbody');
  const countPill = document.getElementById('std-leave-count-pill');
  if (!tbody) return;

  try {
    const res = await axios.get(`${API_BASE}/api/leave?student_id=${studentUser.id || ''}`);
    const requests = res.data.leave_requests || [];

    if (countPill) countPill.textContent = `${requests.length} request${requests.length === 1 ? '' : 's'}`;

    if (requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No leave requests submitted yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = requests.map((req, idx) => {
      const subject = req.subjects?.name || 'Class Subject';
      const date = req.leave_date || 'Date';
      const statusBadge = getStudentLeaveStatusBadge(req.status);
      const reqId = req.id ? `REQ-${req.id.slice(0, 8).toUpperCase()}` : `REQ-${String(idx + 1).padStart(4, '0')}`;

      return `
        <tr>
          <td><span class="bpes-req-id">${escapeHtml(reqId)}</span></td>
          <td><span class="text-nowrap small text-dark">${escapeHtml(date)}</span></td>
          <td><span class="badge bg-light text-dark border">${escapeHtml(subject)}</span></td>
          <td><span class="small text-secondary" style="max-width: 180px; display: inline-block;">${escapeHtml(req.reason)}</span></td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error fetching student leave history:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-warning">Could not load past requests.</td></tr>`;
  }
}

function getStudentStatusBadge(status) {
  const s = String(status || 'present').toLowerCase();
  if (s === 'present') return '<span class="bpes-badge bpes-badge-present"><i class="fas fa-check"></i> Present</span>';
  if (s === 'late') return '<span class="bpes-badge bpes-badge-late"><i class="fas fa-clock"></i> Late</span>';
  if (s === 'absent') return '<span class="bpes-badge bpes-badge-absent"><i class="fas fa-times"></i> Absent</span>';
  if (s === 'excused') return '<span class="bpes-badge bpes-badge-excused"><i class="fas fa-info-circle"></i> Excused</span>';
  return `<span class="bpes-badge bpes-badge-present">${escapeHtml(s)}</span>`;
}

function getStudentLeaveStatusBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'approved') return '<span class="bpes-badge bpes-badge-approved">Approved</span>';
  if (s === 'rejected' || s === 'declined') return '<span class="bpes-badge bpes-badge-declined">Declined</span>';
  return '<span class="bpes-badge bpes-badge-pending">Pending</span>';
}
