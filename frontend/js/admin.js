// ============================================================
// ADMINISTRATOR PORTAL CONTROLLER (Figma Screens 4, 6, 7)
// Tap-to-Enroll, Teachers Directory, and Real-Time Live Taps
// ============================================================

let tapPollInterval = null;
let logsAutoRefreshInterval = null;
let isScanningRfid = false;

function initAdminPortal() {
  const datePill = document.getElementById('admin-date-pill');
  if (datePill) {
    datePill.textContent = `Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  const streamDateEl = document.getElementById('adm-stream-date-display');
  if (streamDateEl) {
    const now = new Date();
    const dateFormatted = now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    streamDateEl.textContent = `Today, ${dateFormatted}`;
  }

  // Set default enrollment date to today
  const enrollDateInput = document.getElementById('enroll-date-input');
  if (enrollDateInput) {
    enrollDateInput.value = new Date().toISOString().split('T')[0];
  }

  // Populate Room Dropdowns & Section Filter
  populateAdminRoomDropdowns();
  populateAdminSectionFilter();

  showAdminTab('students');
  loadAdminStudents();
  loadAdminTeachers();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('triggerScan') === '1') {
    setTimeout(() => {
      startTapToEnrollInline();
    }, 400);
  }
}

function populateAdminSectionFilter() {
  const el = document.getElementById('adm-log-section-filter');
  if (!el) return;

  const sectionSet = new Set();
  (students || []).forEach(s => {
    if (s.section && typeof s.section === 'string' && s.section.trim()) {
      sectionSet.add(s.section.trim());
    }
  });

  const sortedSections = Array.from(sectionSet).sort();
  if (sortedSections.length > 0) {
    el.innerHTML = '<option value="">All sections</option>' +
      sortedSections.map(sec => `<option value="${escapeHtml(sec)}">${escapeHtml(sec)}</option>`).join('');
  }
}

function populateAdminRoomDropdowns() {
  const enrollRoomSelect = document.getElementById('enroll-room-input');
  if (enrollRoomSelect && rooms.length > 0) {
    enrollRoomSelect.innerHTML = rooms.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
  }
}

// ── Admin Tabs ────────────────────────────────────────────────

function showAdminTab(tab) {
  const tabs = ['students', 'teachers', 'logs'];
  tabs.forEach(t => {
    document.getElementById(`adm-tab-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tablink-adm-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`sidebar-adm-${t}`)?.classList.toggle('active', t === tab);
  });

  const sidebarTitle = document.getElementById('admin-sidebar-title');
  const sidebarDesc = document.getElementById('admin-sidebar-desc');
  const brandTitle = document.getElementById('admin-brand-title');
  const mobileTitle = document.getElementById('admin-mobile-header-title');
  const welcomeDesc = document.getElementById('admin-welcome-desc');

  if (tab === 'students') {
    if (sidebarTitle) sidebarTitle.textContent = 'Student Enrollment';
    if (sidebarDesc) sidebarDesc.textContent = 'Tap-to-enroll workflow, enrolled students, and system summaries.';
    if (brandTitle) brandTitle.textContent = 'Student Enrollment';
    if (mobileTitle) mobileTitle.textContent = 'Student Enrollment';
    if (welcomeDesc) welcomeDesc.textContent = 'Manage student enrollment, review enrolled students, and monitor system health.';
    loadAdminStudents();
    stopAutoRefreshLogs();
  } else if (tab === 'teachers') {
    if (sidebarTitle) sidebarTitle.textContent = 'Teachers';
    if (sidebarDesc) sidebarDesc.textContent = 'Manage teacher registration, review registered teachers, and monitor system health.';
    if (brandTitle) brandTitle.textContent = 'Teachers';
    if (mobileTitle) mobileTitle.textContent = 'Teachers';
    if (welcomeDesc) welcomeDesc.textContent = 'Manage teacher registration, review registered teachers, and monitor system health.';
    loadAdminTeachers();
    stopAutoRefreshLogs();
  } else if (tab === 'logs') {
    if (sidebarTitle) sidebarTitle.textContent = 'Attendance Stream';
    if (sidebarDesc) sidebarDesc.textContent = 'Monitor live RFID taps, review attendance by section, and keep room coverage up to date.';
    if (brandTitle) brandTitle.textContent = 'Attendance Stream';
    if (mobileTitle) mobileTitle.textContent = 'Attendance Stream';
    if (welcomeDesc) welcomeDesc.textContent = 'Monitor live RFID taps, review attendance by section, and keep room coverage up to date.';
    loadAdminLogs();
    startAutoRefreshLogs();
  }
}

function startAutoRefreshLogs() {
  stopAutoRefreshLogs();
  logsAutoRefreshInterval = setInterval(() => {
    loadAdminLogs(true);
  }, 3000);
}

function stopAutoRefreshLogs() {
  if (logsAutoRefreshInterval) {
    clearInterval(logsAutoRefreshInterval);
    logsAutoRefreshInterval = null;
  }
}

// ── Interactive RFID Tap Scanner Modal & Sound Effect ──────────

function playRfidChirp() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Melodic positive chime (880Hz A5 -> 1320Hz E6)
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Audio synthesis blocked by browser autoplay policy
  }
}

function openRfidScanModal() {
  const modal = document.getElementById('rfid-scan-modal');
  if (!modal) return;

  // Reset modal state to active listening
  const radar = document.getElementById('rfid-modal-radar');
  const iconCircle = document.getElementById('rfid-modal-icon-circle');
  const icon = document.getElementById('rfid-modal-icon');
  const badge = document.getElementById('rfid-modal-badge');
  const dot = document.getElementById('rfid-modal-dot');
  const badgeText = document.getElementById('rfid-modal-badge-text');
  const title = document.getElementById('rfid-modal-title');
  const desc = document.getElementById('rfid-modal-desc');
  const cardInfo = document.getElementById('rfid-modal-card-info');
  const cancelBtn = document.getElementById('rfid-modal-cancel-btn');

  if (radar) radar.classList.remove('stopped');
  if (iconCircle) iconCircle.classList.remove('detected');
  if (icon) icon.className = 'fas fa-id-card';
  if (badge) badge.classList.remove('detected');
  if (dot) dot.classList.remove('detected');
  if (badgeText) badgeText.textContent = 'SCANNER ACTIVE';
  if (title) title.textContent = 'Waiting for RFID Scan...';
  if (desc) desc.textContent = "Please tap or hold the student's RFID card on the reader.";
  if (cardInfo) cardInfo.classList.add('d-none');
  if (cancelBtn) {
    cancelBtn.innerHTML = '<i class="fas fa-times me-1"></i> Cancel Scan';
    cancelBtn.className = 'bpes-btn-outline px-4 py-2';
  }

  modal.classList.add('active');
}

function closeRfidScanModal() {
  const modal = document.getElementById('rfid-scan-modal');
  if (modal) modal.classList.remove('active');

  stopTapPolling();
  isScanningRfid = false;

  const statusText = document.getElementById('rfid-scan-status-text');
  const scanIcon = document.getElementById('rfid-scan-icon');
  const scanBtn = document.getElementById('btn-scan-rfid');
  const rfidInput = document.getElementById('enroll-rfid-input');

  if (scanIcon) scanIcon.style.animation = 'none';

  // If already detected, keep the detected label
  if (rfidInput && rfidInput.value.trim()) {
    if (statusText) statusText.innerHTML = `<span class="text-success fw-bold"><i class="fas fa-check-circle me-1"></i> Card detected: ${escapeHtml(rfidInput.value)}</span>`;
    if (scanBtn) scanBtn.innerHTML = '<i class="fas fa-rotate me-2"></i> Rescan RFID card';
  } else {
    if (statusText) statusText.textContent = 'Ready to enroll';
    if (scanBtn) scanBtn.innerHTML = '<i class="fas fa-id-card me-2"></i> Scan RFID card';
  }
}

function handleRfidModalBackdropClick(e) {
  if (e.target.id === 'rfid-scan-modal') {
    closeRfidScanModal();
  }
}

// ── Tap to Enroll Inline Workflow (Figma Screen 4) ────────────

async function startTapToEnrollInline() {
  const statusText = document.getElementById('rfid-scan-status-text');
  const scanIcon = document.getElementById('rfid-scan-icon');
  const scanBtn = document.getElementById('btn-scan-rfid');
  const rfidInput = document.getElementById('enroll-rfid-input');

  isScanningRfid = true;
  if (statusText) statusText.textContent = 'Waiting for RFID card tap...';
  if (scanBtn) scanBtn.innerHTML = '<i class="fas fa-times me-2"></i> Cancel Scan';
  if (scanIcon) scanIcon.style.animation = 'pulse 1s infinite';

  // Pop out interactive modal window
  openRfidScanModal();

  try {
    await axios.post(`${API_BASE}/api/scan/clear-tap`).catch(() => null);
  } catch (e) {}

  stopTapPolling();
  tapPollInterval = setInterval(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/scan/latest-tap`);
      const scan = res.data.scan;

      if (scan && scan.uid) {
        stopTapPolling();
        isScanningRfid = false;
        const uid = scan.formatted || scan.uid;

        // Play feedback sound
        playRfidChirp();

        // Update form input and highlight it
        if (rfidInput) {
          rfidInput.value = uid;
          rfidInput.style.borderColor = 'var(--color-primary)';
          rfidInput.style.boxShadow = '0 0 0 3px rgba(15, 76, 58, 0.15)';
        }

        // Update modal UI interactively
        const radar = document.getElementById('rfid-modal-radar');
        const iconCircle = document.getElementById('rfid-modal-icon-circle');
        const icon = document.getElementById('rfid-modal-icon');
        const badge = document.getElementById('rfid-modal-badge');
        const dot = document.getElementById('rfid-modal-dot');
        const badgeText = document.getElementById('rfid-modal-badge-text');
        const title = document.getElementById('rfid-modal-title');
        const desc = document.getElementById('rfid-modal-desc');
        const cardInfo = document.getElementById('rfid-modal-card-info');
        const cardUidEl = document.getElementById('rfid-modal-card-uid');
        const cancelBtn = document.getElementById('rfid-modal-cancel-btn');

        if (radar) radar.classList.add('stopped');
        if (iconCircle) iconCircle.classList.add('detected');
        if (icon) icon.className = 'fas fa-check';
        if (badge) badge.classList.add('detected');
        if (dot) dot.classList.add('detected');
        if (badgeText) badgeText.textContent = 'CARD DETECTED';
        if (title) title.textContent = 'Card Scanned Successfully!';
        if (desc) desc.textContent = 'RFID UID captured. Attaching to student enrollment.';
        if (cardUidEl) cardUidEl.textContent = uid;
        if (cardInfo) cardInfo.classList.remove('d-none');
        if (cancelBtn) {
          cancelBtn.innerHTML = '<i class="fas fa-check me-1"></i> Continue';
          cancelBtn.className = 'bpes-btn px-4 py-2 text-white';
          cancelBtn.style.background = 'var(--color-primary)';
        }

        // Update background inline scan status
        if (statusText) statusText.innerHTML = `<span class="text-success fw-bold"><i class="fas fa-check-circle me-1"></i> Card detected: ${escapeHtml(uid)}</span>`;
        if (scanBtn) scanBtn.innerHTML = '<i class="fas fa-rotate me-2"></i> Rescan RFID card';
        if (scanIcon) scanIcon.style.animation = 'none';

        // Auto-close after 1.4 seconds of visual confirmation
        setTimeout(() => {
          const modal = document.getElementById('rfid-scan-modal');
          if (modal && modal.classList.contains('active')) {
            closeRfidScanModal();
          }
        }, 1400);
      }
    } catch (err) {
      console.error('Tap poll error', err);
    }
  }, 800);
}

function stopTapPolling() {
  if (tapPollInterval) {
    clearInterval(tapPollInterval);
    tapPollInterval = null;
  }
}

async function submitInlineEnrollForm(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-enroll');
  const studentId = document.getElementById('enroll-id-input')?.value.trim();
  const fullName = document.getElementById('enroll-name-input')?.value.trim();
  const section = document.getElementById('enroll-section-input')?.value.trim();
  const room = document.getElementById('enroll-room-input')?.value;
  const rfidUid = document.getElementById('enroll-rfid-input')?.value.trim();

  // Guardian details
  const guardianName = document.getElementById('enroll-guardian-name')?.value.trim();
  const guardianPhone = document.getElementById('enroll-guardian-phone')?.value.trim();
  const guardianRelation = document.getElementById('enroll-guardian-relation')?.value;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Enrolling...';
  }

  try {
    await axios.post(`${API_BASE}/api/students`, {
      student_id: studentId,
      full_name: fullName,
      rfid_uid: (rfidUid && rfidUid !== '-') ? rfidUid : null,
      course: 'Elementary',
      year_level: 1,
      section: section || 'Diamond',
      guardian: {
        full_name: guardianName,
        phone_number: guardianPhone,
        relationship: guardianRelation || 'Parent'
      }
    });

    notify('admin', `Student ${escapeHtml(fullName)} successfully enrolled!`, 'success');
    document.getElementById('enrollment-form')?.reset();
    
    // Reset date input
    const enrollDateInput = document.getElementById('enroll-date-input');
    if (enrollDateInput) enrollDateInput.value = new Date().toISOString().split('T')[0];

    const statusText = document.getElementById('rfid-scan-status-text');
    if (statusText) statusText.textContent = 'Ready to enroll';

    const scanBtn = document.getElementById('btn-scan-rfid');
    if (scanBtn) scanBtn.innerHTML = '<i class="fas fa-id-card me-2"></i> Scan RFID card';

    const enrollRfidInput = document.getElementById('enroll-rfid-input');
    if (enrollRfidInput) {
      enrollRfidInput.style.borderColor = '';
      enrollRfidInput.style.boxShadow = '';
    }

    await loadSystemData();
    await loadAdminStudents();
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Enrollment failed';
    notify('admin', `Enrollment error: ${msg}`, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Enroll student</span>';
    }
  }
}

// ── Students Management & Table Rendering ─────────────────────

async function loadAdminStudents() {
  const tbody = document.getElementById('adm-students-tbody');
  if (!tbody) return;

  try {
    const res = await axios.get(`${API_BASE}/api/students`);
    students = res.data.students || [];

    const countEl = document.getElementById('adm-student-count');
    if (countEl) countEl.textContent = students.length;

    const countPill = document.getElementById('enrolled-count-pill');
    if (countPill) countPill.textContent = `${students.length} students`;

    renderStudentsTable(students);
    populateAdminSectionFilter();
  } catch (err) {
    console.error('Error loading students:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-warning">Could not load students. Verify backend is running.</td></tr>`;
  }
}

function renderStudentsTable(list) {
  const tbody = document.getElementById('adm-students-tbody');
  const paginationLabel = document.getElementById('adm-students-pagination-label');
  if (!tbody) return;

  if (paginationLabel) {
    paginationLabel.textContent = `Showing ${list.length} student record${list.length === 1 ? '' : 's'}`;
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No students enrolled yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const initials = s.full_name ? s.full_name.charAt(0).toUpperCase() : 'S';
    const guardian = (s.guardians && s.guardians.length > 0) ? s.guardians[0] : null;
    const guardianHtml = guardian ? `<div class="small text-muted mt-1" style="font-size: 0.72rem;"><i class="fas fa-user-shield text-success me-1"></i>${escapeHtml(guardian.full_name)} (${escapeHtml(guardian.relationship || 'Guardian')}: ${escapeHtml(guardian.phone_number || '')})</div>` : '';
    const rfidTag = (s.rfid_uid && s.rfid_uid !== '-') ? `<span class="fw-bold text-success">${escapeHtml(s.rfid_uid)}</span>` : `<span class="badge bg-warning text-dark"><i class="fas fa-clock me-1"></i>Pending RFID</span>`;

    return `
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            <div class="d-flex align-items-center justify-content-center fw-bold text-white small" style="width: 32px; height: 32px; border-radius: 50%; background: #14532D; flex-shrink: 0;">
              ${initials}
            </div>
            <div>
              <div class="fw-bold text-dark">${escapeHtml(s.full_name)}</div>
              <div class="small text-muted" style="font-size: 0.78rem;">${escapeHtml(s.student_id)}</div>
              ${guardianHtml}
            </div>
          </div>
        </td>
        <td><span class="badge bg-light text-dark border">Grade ${s.year_level || 1} &bull; ${escapeHtml(s.section || 'Diamond')}</span></td>
        <td>${rfidTag}</td>
        <td><span class="small text-muted">Room 101</span></td>
        <td><span class="badge rounded-pill bg-light text-success border px-2 py-1">Enrolled</span></td>
        <td>
          <button class="bpes-btn-danger-outline bpes-btn-sm" onclick="handleAdminDeleteStudent('${s.id}', '${escapeHtml(s.full_name)}')">
            <i class="fas fa-trash me-1"></i> Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminStudents() {
  const query = (document.getElementById('adm-student-search')?.value || '').toLowerCase();
  if (!query) {
    renderStudentsTable(students);
    return;
  }
  const filtered = students.filter(s =>
    (s.full_name && s.full_name.toLowerCase().includes(query)) ||
    (s.student_id && s.student_id.toLowerCase().includes(query)) ||
    (s.section && s.section.toLowerCase().includes(query)) ||
    (s.rfid_uid && s.rfid_uid.toLowerCase().includes(query))
  );
  renderStudentsTable(filtered);
}

async function handleAdminDeleteStudent(id, name) {
  if (!confirm(`Are you sure you want to remove student "${name}"?`)) return;
  try {
    await axios.delete(`${API_BASE}/api/students/${id}`);
    notify('admin', `Removed student "${escapeHtml(name)}"`, 'warning');
    await loadSystemData();
    await loadAdminStudents();
  } catch (err) {
    notify('admin', `Delete failed: ${err.message}`, 'danger');
  }
}

// ── Teachers Management & Table Rendering (Figma Screen 7) ────

async function loadAdminTeachers() {
  const tbody = document.getElementById('adm-teachers-tbody');
  if (!tbody) return;

  try {
    const res = await axios.get(`${API_BASE}/api/teachers`);
    teachers = res.data.teachers || [];

    const countEl = document.getElementById('adm-teacher-count');
    if (countEl) countEl.textContent = teachers.length;

    const countPill = document.getElementById('teachers-count-pill');
    if (countPill) countPill.textContent = `${teachers.length} teachers`;

    renderTeachersTable(teachers);
  } catch (err) {
    console.error('Error loading teachers', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Failed to load teachers</td></tr>`;
  }
}

function renderTeachersTable(list) {
  const tbody = document.getElementById('adm-teachers-tbody');
  const paginationLabel = document.getElementById('adm-teachers-pagination-label');
  if (!tbody) return;

  if (paginationLabel) {
    paginationLabel.textContent = `Showing ${list.length} teacher record${list.length === 1 ? '' : 's'}`;
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No teachers registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const initials = t.full_name ? t.full_name.charAt(0).toUpperCase() : 'T';
    return `
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            <div class="d-flex align-items-center justify-content-center fw-bold text-white small" style="width: 32px; height: 32px; border-radius: 50%; background: #14532D; flex-shrink: 0;">
              ${initials}
            </div>
            <div>
              <div class="fw-bold text-dark">${escapeHtml(t.full_name)}</div>
              <div class="small text-muted" style="font-size: 0.78rem;">${escapeHtml(t.id ? t.id.slice(0, 8) : 'T-2025')}</div>
            </div>
          </div>
        </td>
        <td><span class="small fw-medium text-dark">${escapeHtml(t.role || 'Teacher I')}</span></td>
        <td><span class="small text-muted">${escapeHtml(t.email)}</span></td>
        <td><span class="badge bg-light text-dark border">Regular</span></td>
        <td><span class="badge rounded-pill bg-light text-success border px-2 py-1">Registered</span></td>
        <td>
          <button class="bpes-btn-danger-outline bpes-btn-sm" onclick="handleAdminDeleteTeacher('${t.id}', '${escapeHtml(t.full_name)}')">
            <i class="fas fa-trash me-1"></i> Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminTeachers() {
  const query = (document.getElementById('adm-teacher-search')?.value || '').toLowerCase();
  if (!query) {
    renderTeachersTable(teachers);
    return;
  }
  const filtered = teachers.filter(t =>
    (t.full_name && t.full_name.toLowerCase().includes(query)) ||
    (t.email && t.email.toLowerCase().includes(query)) ||
    (t.role && t.role.toLowerCase().includes(query))
  );
  renderTeachersTable(filtered);
}

async function submitInlineTeacherForm(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-teacher');
  const name = document.getElementById('tch-name-input')?.value.trim();
  const email = document.getElementById('tch-email-input')?.value.trim();
  const position = document.getElementById('tch-position-input')?.value;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Registering...';
  }

  try {
    await axios.post(`${API_BASE}/api/teachers`, {
      full_name: name,
      email: email,
      role: position || 'Teacher I',
      password: 'teacher123'
    });

    notify('admin', `Teacher "${escapeHtml(name)}" registered successfully!`, 'success');
    document.getElementById('teacher-registration-form')?.reset();
    await loadAdminTeachers();
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Failed to register teacher';
    notify('admin', `Registration error: ${msg}`, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Register teacher</span>';
    }
  }
}

async function handleAdminDeleteTeacher(id, name) {
  if (!confirm(`Are you sure you want to remove teacher "${name}"?`)) return;
  try {
    await axios.delete(`${API_BASE}/api/teachers/${id}`);
    notify('admin', `Removed teacher "${escapeHtml(name)}"`, 'warning');
    await loadAdminTeachers();
  } catch (err) {
    notify('admin', `Delete failed: ${err.message}`, 'danger');
  }
}

// ── Attendance Stream (Figma Screen 6) ────────────────────────

async function loadAdminLogs(isSilent = false) {
  const tbody = document.getElementById('adm-logs-tbody');
  const countBadge = document.getElementById('adm-stream-status-badge');
  const countLabel = document.getElementById('adm-logs-count-label');
  const sectionFilter = document.getElementById('adm-log-section-filter')?.value;
  if (!tbody) return;

  try {
    const res = await axios.get(`${API_BASE}/api/attendance`);
    let logs = res.data.logs || [];

    if (sectionFilter) {
      logs = logs.filter(l => l.students && l.students.section === sectionFilter);
    }

    if (countBadge) {
      countBadge.textContent = `${logs.length} taps`;
    }
    if (countLabel) {
      countLabel.textContent = `Live Stream: ${logs.length} logged tap${logs.length === 1 ? '' : 's'}`;
    }

    if (logs.length === 0) {
      if (!isSilent) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No live attendance taps recorded yet today.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const student = l.students;
      const name = student ? escapeHtml(student.full_name) : (l.rfid_uid ? `Card ${escapeHtml(l.rfid_uid)}` : 'Unassigned Card');
      const id = student ? escapeHtml(student.student_id) : (l.rfid_uid ? escapeHtml(l.rfid_uid) : '—');
      const section = student?.section || (student ? '—' : 'Unregistered');
      const room = l.rooms?.name || '—';
      const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const date = new Date(l.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const statusBadge = getStatusBadge(l.status);
      const initials = name.charAt(0).toUpperCase();

      return `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="d-flex align-items-center justify-content-center fw-bold text-white small" style="width: 32px; height: 32px; border-radius: 50%; background: #14532D; flex-shrink: 0;">
                ${initials}
              </div>
              <strong class="text-dark">${name}</strong>
            </div>
          </td>
          <td><span class="bpes-cell-lrn">${id}</span></td>
          <td><span class="badge bg-light text-dark border">${escapeHtml(section)}</span></td>
          <td><span class="small text-muted">${escapeHtml(room)}</span></td>
          <td>${statusBadge}</td>
          <td>
            <div class="small fw-semibold text-dark">${time}</div>
            <div class="text-muted" style="font-size: 0.75rem;">${date}</div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (!isSilent) {
      console.error('Error fetching admin logs', err);
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-warning">Could not fetch live taps.</td></tr>`;
    }
  }
}

function getStatusBadge(status) {
  const s = String(status || 'present').toLowerCase();
  if (s === 'present') return '<span class="bpes-badge bpes-badge-present"><i class="fas fa-check"></i> Present</span>';
  if (s === 'late') return '<span class="bpes-badge bpes-badge-late"><i class="fas fa-clock"></i> Late</span>';
  if (s === 'absent') return '<span class="bpes-badge bpes-badge-absent"><i class="fas fa-times"></i> Absent</span>';
  if (s === 'excused') return '<span class="bpes-badge bpes-badge-excused"><i class="fas fa-info-circle"></i> Excused</span>';
  if (s === 'unknown') return '<span class="bpes-badge bpes-badge-warning"><i class="fas fa-question-circle"></i> Unregistered</span>';
  return `<span class="bpes-badge bpes-badge-present">${escapeHtml(s)}</span>`;
}
