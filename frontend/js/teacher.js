// ============================================================
// TEACHER PORTAL CONTROLLER (Figma Screens 8, 9, 10, 11)
// Dashboard Analytics, Inline Override, Export Attendance, Leave Review
// ============================================================

let teacherAutoRefreshInterval = null;
let currentTeacherAttendanceLogs = [];

function initTeacherPortal() {
  const today = new Date().toISOString().split('T')[0];
  const dateInputs = ['teacher-analytics-date', 'teacher-export-date'];
  dateInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });

  const todayDateBadge = document.getElementById('teacher-today-date');
  if (todayDateBadge) {
    todayDateBadge.textContent = `Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Populate Room Dropdowns
  const exportRoomSelect = document.getElementById('teacher-export-room');
  if (exportRoomSelect && rooms.length > 0) {
    exportRoomSelect.innerHTML = '<option value="">All Classrooms</option>' +
      rooms.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
  }

  // Update teacher name, email & avatar in sidebar & greeting
  const navBadge = document.getElementById('teacher-nav-badge');
  const greeting = document.getElementById('teacher-greeting');
  const avatar = document.getElementById('teacher-avatar');
  const sidebarUserName = document.getElementById('teacher-sidebar-user-name');
  const sidebarUserEmail = document.getElementById('teacher-sidebar-user-email');

  if (currentTeacherUser && currentTeacherUser.name) {
    if (navBadge) navBadge.textContent = currentTeacherUser.name;
    if (greeting) greeting.textContent = `Good morning, ${currentTeacherUser.name}!`;
    if (avatar) avatar.textContent = currentTeacherUser.name.charAt(0).toUpperCase();
    if (sidebarUserName) sidebarUserName.textContent = currentTeacherUser.name;
    if (sidebarUserEmail) sidebarUserEmail.textContent = currentTeacherUser.email || 'Faculty Member';
  }

  populateTeacherSectionFilter();
  showTeacherTab('dashboard');
}

function populateTeacherSectionFilter() {
  const el = document.getElementById('teacher-section-filter');
  if (!el) return;

  const sectionSet = new Set();
  (students || []).forEach(s => {
    if (s.section && typeof s.section === 'string' && s.section.trim()) {
      sectionSet.add(s.section.trim());
    }
  });

  const sortedSections = Array.from(sectionSet).sort();
  if (sortedSections.length > 0) {
    el.innerHTML = '<option value="">All Sections</option>' +
      sortedSections.map(sec => `<option value="${escapeHtml(sec)}">${escapeHtml(sec)}</option>`).join('');
  }
}

// ── Teacher Tabs ──────────────────────────────────────────────

function showTeacherTab(tab) {
  const tabs = ['dashboard', 'attendance', 'export', 'leave'];
  tabs.forEach(t => {
    document.getElementById(`tch-tab-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tablink-tch-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`sidebar-tch-${t}`)?.classList.toggle('active', t === tab);
  });

  const sidebarTitle = document.getElementById('teacher-sidebar-title');
  const sidebarDesc = document.getElementById('teacher-sidebar-desc');
  const brandTitle = document.getElementById('teacher-brand-title');
  const mobileTitle = document.getElementById('teacher-mobile-header-title');
  const welcomeDesc = document.getElementById('teacher-welcome-desc');

  if (tab === 'dashboard') {
    if (sidebarTitle) sidebarTitle.textContent = 'Dashboard';
    if (sidebarDesc) sidebarDesc.textContent = 'Classroom attendance metrics, student status override, and leave review.';
    if (brandTitle) brandTitle.textContent = 'Dashboard';
    if (mobileTitle) mobileTitle.textContent = 'Dashboard';
    if (welcomeDesc) welcomeDesc.textContent = "Welcome back! Here's what's happening with your classes today.";
    loadTeacherDashboardData();
    stopTeacherAutoRefresh();
  } else if (tab === 'attendance') {
    if (sidebarTitle) sidebarTitle.textContent = 'Attendance';
    if (sidebarDesc) sidebarDesc.textContent = 'Filter by date and class — override individual attendance records.';
    if (brandTitle) brandTitle.textContent = 'Attendance';
    if (mobileTitle) mobileTitle.textContent = 'Attendance';
    if (welcomeDesc) welcomeDesc.textContent = 'Live monitoring across your classes with manual status override.';
    loadTeacherAttendance();
    startTeacherAutoRefresh();
  } else if (tab === 'export') {
    if (sidebarTitle) sidebarTitle.textContent = 'Export Attendance';
    if (sidebarDesc) sidebarDesc.textContent = 'Generate official Department of Education attendance log sheets.';
    if (brandTitle) brandTitle.textContent = 'Export Attendance';
    if (mobileTitle) mobileTitle.textContent = 'Export Attendance';
    if (welcomeDesc) welcomeDesc.textContent = 'Download CSV or print daily attendance rosters.';
    generateTeacherExportPreview();
    stopTeacherAutoRefresh();
  } else if (tab === 'leave') {
    if (sidebarTitle) sidebarTitle.textContent = 'Student Leave Requests';
    if (sidebarDesc) sidebarDesc.textContent = 'Review student medical, emergency, and excuse submissions.';
    if (brandTitle) brandTitle.textContent = 'Student Leave Requests';
    if (mobileTitle) mobileTitle.textContent = 'Student Leave Requests';
    if (welcomeDesc) welcomeDesc.textContent = 'Review submitted excuse requests with supporting proof documents.';
    loadTeacherLeaveRequests();
    stopTeacherAutoRefresh();
  }
}

function startTeacherAutoRefresh() {
  stopTeacherAutoRefresh();
  teacherAutoRefreshInterval = setInterval(() => {
    loadTeacherAttendance(true);
  }, 5000);
}

function stopTeacherAutoRefresh() {
  if (teacherAutoRefreshInterval) {
    clearInterval(teacherAutoRefreshInterval);
    teacherAutoRefreshInterval = null;
  }
}

// ── Tab 1: Dashboard Metrics & Recent Scans (Figma Screen 8) ───

async function loadTeacherDashboardData() {
  try {
    if (!students || students.length === 0) {
      try {
        const stdRes = await axios.get(`${API_BASE}/api/students`);
        students = stdRes.data.students || [];
        populateTeacherSectionFilter();
      } catch (e) {}
    }

    const res = await axios.get(`${API_BASE}/api/attendance`);
    const logs = res.data.logs || [];
    const today = new Date().toISOString().split('T')[0];

    const todayLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(today));
    const presentCount = todayLogs.filter(l => l.status === 'present').length;
    const lateCount = todayLogs.filter(l => l.status === 'late').length;
    const absentCount = todayLogs.filter(l => l.status === 'absent' || l.status === 'excused').length;

    const totalEl = document.getElementById('tch-kpi-total');
    const presentEl = document.getElementById('tch-kpi-present');
    const lateEl = document.getElementById('tch-kpi-late');
    const absentEl = document.getElementById('tch-kpi-absent');
    const presentSubEl = document.getElementById('tch-kpi-present-sub');

    const totalCount = students.length;
    if (totalEl) totalEl.textContent = totalCount;
    if (presentEl) presentEl.textContent = presentCount;
    if (lateEl) lateEl.textContent = lateCount;
    if (absentEl) absentEl.textContent = absentCount;
    if (presentSubEl) {
      const rate = totalCount > 0 ? ((presentCount / totalCount) * 100).toFixed(1) : '0';
      presentSubEl.textContent = `${rate}% attendance`;
    }

    // Render Recent Scans Table (Screen 8)
    const recentTbody = document.getElementById('tch-recent-logs-tbody');
    const recentPill = document.getElementById('recent-scans-pill');

    const displayLogs = todayLogs.length > 0 ? todayLogs.slice(0, 5) : logs.slice(0, 5);
    if (recentPill) recentPill.textContent = `${displayLogs.length} student${displayLogs.length === 1 ? '' : 's'}`;

    if (recentTbody) {
      if (displayLogs.length === 0) {
        recentTbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No student cards scanned today yet.</td></tr>`;
      } else {
        recentTbody.innerHTML = displayLogs.map(l => {
          const student = l.students;
          const name = student ? escapeHtml(student.full_name) : (l.rfid_uid ? `Card ${escapeHtml(l.rfid_uid)}` : 'Unassigned Card');
          const room = l.rooms?.name || '—';
          const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const badge = getTeacherStatusBadge(l.status);
          const initials = name.charAt(0).toUpperCase();

          return `
            <tr>
              <td>
                <div class="d-flex align-items-center gap-2">
                  <div class="d-flex align-items-center justify-content-center fw-bold text-white small" style="width: 30px; height: 30px; border-radius: 50%; background: #14532D; flex-shrink: 0;">
                    ${initials}
                  </div>
                  <strong class="text-dark">${name}</strong>
                </div>
              </td>
              <td>${badge}</td>
              <td><span class="small text-muted">${escapeHtml(room)}</span></td>
              <td><span class="small fw-medium text-dark">${time}</span></td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Teacher dashboard data error:', err);
  }
}

// ── Tab 2: Attendance Monitoring & Inline Override (Figma Screen 9) ───

async function loadTeacherAttendance(isSilent = false) {
  const tbody = document.getElementById('tch-attendance-tbody');
  const countPill = document.getElementById('attendance-count-pill');
  const countLabel = document.getElementById('tch-attendance-count-label');
  if (!tbody) return;

  const dateFilter = document.getElementById('teacher-analytics-date')?.value;
  const sectionFilter = document.getElementById('teacher-section-filter')?.value;

  try {
    const res = await axios.get(`${API_BASE}/api/attendance`);
    let logs = res.data.logs || [];

    if (dateFilter) {
      logs = logs.filter(l => l.timestamp && l.timestamp.startsWith(dateFilter));
    }
    if (sectionFilter) {
      logs = logs.filter(l => l.students && l.students.section === sectionFilter);
    }

    currentTeacherAttendanceLogs = logs;

    if (countPill) countPill.textContent = `${logs.length} students`;
    if (countLabel) countLabel.textContent = `Showing ${logs.length} attendance record${logs.length === 1 ? '' : 's'}`;

    if (logs.length === 0) {
      if (!isSilent) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No attendance logs matching selected criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const student = l.students;
      const name = student ? escapeHtml(student.full_name) : (l.rfid_uid ? `Card ${escapeHtml(l.rfid_uid)}` : 'Unassigned Card');
      const id = student ? escapeHtml(student.student_id) : (l.rfid_uid ? escapeHtml(l.rfid_uid) : '—');
      const room = l.rooms?.name || '—';
      const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const badge = getTeacherStatusBadge(l.status);
      const initials = name.charAt(0).toUpperCase();

      return `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="d-flex align-items-center justify-content-center fw-bold text-white small" style="width: 30px; height: 30px; border-radius: 50%; background: #14532D; flex-shrink: 0;">
                ${initials}
              </div>
              <strong class="text-dark">${name}</strong>
            </div>
          </td>
          <td><span class="bpes-cell-lrn">${id}</span></td>
          <td><span class="small text-muted">${escapeHtml(room)}</span></td>
          <td>${badge}</td>
          <td><span class="small text-dark fw-medium">${time}</span></td>
          <td>
            <button class="bpes-btn-outline bpes-btn-sm" onclick="selectStudentForInlineOverride('${l.id}', '${escapeHtml(name)}', '${escapeHtml(id)}', '${escapeHtml(room)}', '${l.status}')">
              <span>Override</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (!isSilent) {
      console.error('Error fetching teacher attendance', err);
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-warning">Could not load attendance records.</td></tr>`;
    }
  }
}

function selectStudentForInlineOverride(logId, studentName, lrn, roomName, currentStatus) {
  const hiddenId = document.getElementById('override-log-id');
  const nameEl = document.getElementById('override-student-name');
  const metaEl = document.getElementById('override-meta');
  const submitBtn = document.getElementById('override-submit-btn');

  if (hiddenId) hiddenId.value = logId;
  if (nameEl) nameEl.textContent = studentName;
  if (metaEl) metaEl.textContent = `LRN: ${lrn} | ${roomName} | Current: ${currentStatus.toUpperCase()}`;
  if (submitBtn) submitBtn.disabled = false;

  setOverrideStatus(currentStatus || 'present');
}

function setOverrideStatus(status) {
  const statusInput = document.getElementById('override-status-select');
  if (statusInput) statusInput.value = status;

  document.querySelectorAll('.override-status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-status') === status);
  });
}

async function submitAttendanceOverride(e) {
  e.preventDefault();
  const btn = document.getElementById('override-submit-btn');
  const logId = document.getElementById('override-log-id')?.value;
  const newStatus = document.getElementById('override-status-select')?.value || 'present';
  const reason = document.getElementById('override-reason')?.value.trim();

  if (!logId) {
    alert('Please click "Override" on a student row first.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Saving...';
  }

  try {
    await axios.patch(`${API_BASE}/api/override/${logId}`, {
      new_status: newStatus,
      reason: reason || 'Manual instructor adjustment'
    });

    notify('teacher', `Attendance status updated to ${newStatus.toUpperCase()}!`, 'success');
    document.getElementById('override-form')?.reset();
    document.getElementById('override-student-name').textContent = 'Select a student';
    document.getElementById('override-meta').textContent = 'Click "Override" on any row to begin';

    await loadTeacherAttendance();
    await loadTeacherDashboardData();
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Failed to update attendance status';
    notify('teacher', `Override error: ${msg}`, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Confirm override</span>';
    }
  }
}

// ── Tab 3: Export Attendance Sheet (Figma Screen 10) ──────────

function generateTeacherExportPreview() {
  const tbody = document.getElementById('tch-export-tbody');
  const dateInput = document.getElementById('teacher-export-date')?.value || new Date().toISOString().split('T')[0];
  const roomFilter = document.getElementById('teacher-export-room')?.value;

  if (!tbody) return;

  let exportLogs = (currentTeacherAttendanceLogs.length > 0 ? currentTeacherAttendanceLogs : allLogs).filter(l => {
    const dateMatch = !dateInput || (l.timestamp && l.timestamp.startsWith(dateInput));
    const roomMatch = !roomFilter || (l.rooms?.name === roomFilter);
    return dateMatch && roomMatch;
  });

  if (exportLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No attendance records found for ${dateInput}.</td></tr>`;
    return;
  }

  tbody.innerHTML = exportLogs.map((l, index) => {
    const student = l.students;
    const name = student ? escapeHtml(student.full_name) : 'Student';
    const lrn = student ? escapeHtml(student.student_id) : (l.rfid_uid ? escapeHtml(l.rfid_uid) : '—');
    const section = student?.section || (student ? '—' : 'Unregistered');
    const room = l.rooms?.name || '—';
    const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const badge = getTeacherStatusBadge(l.status);

    return `
      <tr>
        <td>${index + 1}</td>
        <td><code>${lrn}</code></td>
        <td class="fw-bold text-dark">${name}</td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(section)}</span></td>
        <td>${escapeHtml(room)}</td>
        <td>${badge}</td>
        <td><span class="small text-muted">${time}</span></td>
      </tr>
    `;
  }).join('');
}

function printAttendanceReport() {
  generateTeacherExportPreview();
  window.print();
}

function exportAttendanceCsv() {
  generateTeacherExportPreview();
  const dateInput = document.getElementById('teacher-export-date')?.value || new Date().toISOString().split('T')[0];
  let exportLogs = currentTeacherAttendanceLogs.length > 0 ? currentTeacherAttendanceLogs : allLogs;

  let csv = 'No.,LRN,Student Full Name,Year & Section,Room,Status,Timestamp\n';
  exportLogs.forEach((l, index) => {
    const student = l.students;
    const name = student ? student.full_name : 'Student';
    const lrn = student ? student.student_id : l.rfid_uid;
    const section = student?.section || 'Grade 7 - Diamond';
    const room = l.rooms?.name || 'Room 101';
    const time = new Date(l.timestamp).toLocaleString();
    const status = l.status || 'present';
    csv += `"${index+1}","${lrn}","${name}","${section}","${room}","${status}","${time}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `Attendance_Report_${dateInput}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── Tab 4: Student Leave Requests (Figma Screen 11) ───────────

async function loadTeacherLeaveRequests() {
  const tbody = document.getElementById('tch-leave-table-tbody');
  const countPill = document.getElementById('leave-requests-pill');
  if (!tbody) return;

  try {
    const res = await axios.get(`${API_BASE}/api/leave`);
    const requests = res.data.leave_requests || [];

    const pending = requests.filter(r => r.status === 'pending').length;
    const approved = requests.filter(r => r.status === 'approved').length;
    const declined = requests.filter(r => r.status === 'rejected' || r.status === 'declined').length;

    document.getElementById('tch-leave-pending-count') && (document.getElementById('tch-leave-pending-count').textContent = pending);
    document.getElementById('tch-leave-approved-count') && (document.getElementById('tch-leave-approved-count').textContent = approved);
    document.getElementById('tch-leave-declined-count') && (document.getElementById('tch-leave-declined-count').textContent = declined);
    document.getElementById('tch-leave-total-count') && (document.getElementById('tch-leave-total-count').textContent = requests.length);

    if (countPill) countPill.textContent = `${requests.length} requests`;

    if (requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No excuse or leave requests submitted yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = requests.map(req => {
      const student = req.students;
      const studentName = student ? escapeHtml(student.full_name) : 'Student';
      const studentId = student ? escapeHtml(student.student_id) : '--';
      const subject = req.subjects?.name || 'Class Subject';
      const leaveDate = req.leave_date || 'Date';
      const statusBadge = getLeaveStatusBadge(req.status);
      const isPending = req.status === 'pending';

      return `
        <tr>
          <td>
            <strong class="text-dark d-block">${studentName}</strong>
            <small class="text-muted">LRN: ${studentId}</small>
          </td>
          <td><span class="badge bg-light text-dark border">${escapeHtml(subject)}</span></td>
          <td><span class="small text-dark fw-medium">${escapeHtml(leaveDate)}</span></td>
          <td><span class="small text-secondary" style="max-width: 200px; display: inline-block;">${escapeHtml(req.reason)}</span></td>
          <td><span class="badge bg-light text-dark border fw-bold">PDF</span></td>
          <td>${statusBadge}</td>
          <td>
            ${isPending ? `
              <div class="d-flex gap-1">
                <button class="bpes-btn-primary bpes-btn-sm py-1 px-2" style="font-size: 11px;" onclick="handleReviewLeave('${req.id}', 'approved')">Approve</button>
                <button class="bpes-btn-outline bpes-btn-sm py-1 px-2 text-danger" style="font-size: 11px;" onclick="handleReviewLeave('${req.id}', 'rejected')">Decline</button>
              </div>
            ` : `
              <span class="small text-muted fst-italic">Reviewed</span>
            `}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching teacher leave requests:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-warning">Could not load leave requests.</td></tr>`;
  }
}

async function handleReviewLeave(leaveId, action) {
  try {
    await axios.patch(`${API_BASE}/api/leave/${leaveId}`, { action });
    notify('teacher', `Leave request ${action === 'approved' ? 'Approved' : 'Declined'} successfully!`, 'success');
    await loadTeacherLeaveRequests();
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Failed to update request';
    notify('teacher', `Error: ${msg}`, 'danger');
  }
}

function getTeacherStatusBadge(status) {
  const s = String(status || 'present').toLowerCase();
  if (s === 'present') return '<span class="bpes-badge bpes-badge-present"><i class="fas fa-check"></i> Present</span>';
  if (s === 'late') return '<span class="bpes-badge bpes-badge-late"><i class="fas fa-clock"></i> Late</span>';
  if (s === 'absent') return '<span class="bpes-badge bpes-badge-absent"><i class="fas fa-times"></i> Absent</span>';
  if (s === 'excused') return '<span class="bpes-badge bpes-badge-excused"><i class="fas fa-info-circle"></i> Excused</span>';
  if (s === 'unknown') return '<span class="bpes-badge bpes-badge-warning"><i class="fas fa-question-circle"></i> Unregistered</span>';
  return `<span class="bpes-badge bpes-badge-present">${escapeHtml(s)}</span>`;
}

function getLeaveStatusBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'approved') return '<span class="bpes-badge bpes-badge-approved"><i class="fas fa-check"></i> Approved</span>';
  if (s === 'rejected' || s === 'declined') return '<span class="bpes-badge bpes-badge-declined"><i class="fas fa-times"></i> Declined</span>';
  return '<span class="bpes-badge bpes-badge-pending"><i class="fas fa-clock"></i> Pending</span>';
}
