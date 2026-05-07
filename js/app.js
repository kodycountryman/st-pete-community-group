/* ============================================
   ST. PETE LAUNCH DASHBOARD — Main App
   Supabase-backed, syncs across all devices
   ============================================ */

const app = {
  // ---- DATA (in-memory cache, loaded from Supabase) ----
  data: {
    people: [],
    groups: [],
    teams: [],
    teamMembersData: [],
    weeklyPrep: null,
    pastWeeks: [],
    attendance: [],
    checkinState: {},  // Session-only, not persisted to DB
    settings: { currentPhase: 1 }
  },

  teamMembers: ['Kody', 'Dewayne', 'Elizabeth', 'James', 'Ashley', 'Madison'],
  currentUser: null,

  // ---- ROLE SYSTEM ----
  ROLE_LEVELS: { owner: 4, admin: 3, editor: 2, leader: 1 },

  hasMinRole(minRole) {
    const myLevel = this.ROLE_LEVELS[this.currentUser?.dbRole] || 0;
    const reqLevel = this.ROLE_LEVELS[minRole] || 0;
    return myLevel >= reqLevel;
  },

  applyRoleRestrictions() {
  },

  // ---- INIT ----
  async init() {
    if (!this.checkAuth()) return;
    this._reachedOut = JSON.parse(localStorage.getItem('stpete_reached_out') || '{}');
    this._seenCheckins = new Set(JSON.parse(localStorage.getItem('stpete_seen_checkins') || '[]'));
    await this.loadData();
    this.setupNavigation();
    this.setupMobileMenu();
    this.setupCSVDrop();
    this.renderAll();
    this.setNextThursday();
    // Seed the seen-checkins list so existing entries don't fire an alert on first load
    this._recordSeenCheckins(true);
    // Poll for new check-ins every 15 seconds
    this._guestPoll = setInterval(() => this.pollForNewGuests(), 15000);
    // Also pick up same-device kiosk events via storage event
    window.addEventListener('storage', (e) => {
      if (e.key === 'stpete_new_guest' && e.newValue) {
        try {
          const g = JSON.parse(e.newValue);
          this.refresh().then(() => this.pollForNewGuests());
        } catch (err) {}
      }
    });
  },

  // Collect the set of (date, personId) pairs currently in attendance state
  _currentCheckinKeys() {
    const keys = new Set();
    (this.data.attendance || []).forEach(a => {
      (a.checkedIn || []).forEach(id => keys.add(`${a.date}|${id}`));
    });
    return keys;
  },

  _recordSeenCheckins(silent) {
    const keys = this._currentCheckinKeys();
    keys.forEach(k => this._seenCheckins.add(k));
    try {
      localStorage.setItem('stpete_seen_checkins', JSON.stringify([...this._seenCheckins]));
    } catch (e) {}
    return keys;
  },

  // Poll for brand-new check-ins and show an alert for any unseen ones.
  async pollForNewGuests() {
    try {
      const fresh = await db.getAttendance();
      const freshParsed = (fresh || []).map(r => db.attendanceFromRow(r));
      const freshPeople = await db.getPeople();
      this.data.people = (freshPeople || []).map(r => db.personFromRow(r));
      this.data.attendance = freshParsed;

      const today = new Date().toISOString().split('T')[0];
      const todayRecord = freshParsed.find(a => a.date === today);
      if (!todayRecord) return;

      const newIds = (todayRecord.checkedIn || []).filter(id => !this._seenCheckins.has(`${today}|${id}`));
      if (newIds.length === 0) return;

      // Mark them all seen immediately so we don't double-notify
      newIds.forEach(id => this._seenCheckins.add(`${today}|${id}`));
      try {
        localStorage.setItem('stpete_seen_checkins', JSON.stringify([...this._seenCheckins]));
      } catch (e) {}

      // Build an alert for each new check-in
      newIds.forEach(id => {
        const person = this.data.people.find(p => p.id === id);
        if (!person) return;
        const isFirstTime = (person.status === 'new') || ((person.attendanceCount || 0) <= 1);
        this.showGuestAlert(person, isFirstTime);
      });

      // Refresh visible UI with the new data
      this.renderAll();
    } catch (err) {
      console.error('pollForNewGuests failed:', err);
    }
  },

  // Show a dashboard banner/toast for a fresh check-in.
  // First-timers get a bigger, stickier alert; returning regulars get a lightweight toast.
  showGuestAlert(person, isFirstTime) {
    if (!isFirstTime) {
      this.toast(`✓ ${person.firstName} just checked in`);
      return;
    }

    // Full banner for first-time guests
    let container = document.getElementById('guestAlertContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'guestAlertContainer';
      container.className = 'guest-alert-container';
      document.body.appendChild(container);
    }

    const alertEl = document.createElement('div');
    alertEl.className = 'guest-alert';
    const invitedBy = person.connector ? ` · invited by <strong>${this.escapeHtml(person.connector)}</strong>` : '';
    const phoneHint = person.phone ? `<div class="guest-alert-sub">📱 ${this.escapeHtml(person.phone)}</div>` : '';
    alertEl.innerHTML = `
      <div class="guest-alert-badge">🆕 First Time</div>
      <div class="guest-alert-name">${this.escapeHtml(person.firstName)} ${this.escapeHtml(person.lastName || '')}</div>
      <div class="guest-alert-meta">Just checked in${invitedBy}</div>
      ${phoneHint}
      <div class="guest-alert-actions">
        <button class="guest-alert-btn" onclick="app.navigate('followup'); this.closest('.guest-alert').remove();">Follow Up</button>
        <button class="guest-alert-dismiss" onclick="this.closest('.guest-alert').remove()">Dismiss</button>
      </div>
    `;
    container.appendChild(alertEl);

    // Play a subtle chime if supported
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      o.stop(ctx.currentTime + 0.4);
    } catch (e) {}

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      if (alertEl.parentNode) alertEl.remove();
    }, 30000);
  },

  checkAuth() {
    const session = JSON.parse(localStorage.getItem('stpete_session') || 'null');
    if (!session || !session.loggedIn) {
      if (!window.location.pathname.includes('login')) {
        window.location.href = 'login.html';
      }
      return false;
    }
    this.currentUser = session;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = session.name;
    this.applyRoleRestrictions();
    return true;
  },

  logout() {
    localStorage.removeItem('stpete_session');
    window.location.href = 'login.html';
  },

  // ---- LOAD FROM SUPABASE ----
  async loadData() {
    try {
      const results = await Promise.allSettled([
        db.getPeople(),
        db.getAttendance(),
        db.getTeams(),
        db.getTeamMembers(),
        db.getGroups(),
        db.getCurrentWeeklyPrep(),
        db.getPastWeeks(),
        db.getGamePlan(),
        db.getPolls()
      ]);

      const val = (i) => results[i].status === 'fulfilled' ? results[i].value : null;

      this.data.people = (val(0) || []).map(r => db.personFromRow(r));
      this.data.attendance = (val(1) || []).map(r => db.attendanceFromRow(r));

      // Sync today's attendance into checkinState so kiosk check-ins show up
      const today = new Date().toISOString().split('T')[0];
      const todayRecord = this.data.attendance.find(a => a.date === today);
      if (todayRecord && todayRecord.checkedIn && todayRecord.checkedIn.length > 0) {
        todayRecord.checkedIn.forEach(id => {
          this.data.checkinState[id] = true;
        });
      }

      this.data.teams = val(2) || [];
      this.data.teamMembersData = val(3) || [];
      this.data.groups = val(4) || [];
      this.data.weeklyPrep = val(5) || { topic: '', scripture: '', takeaway: '', cta: '', icebreaker: '', questions: [] };
      this.data.pastWeeks = val(6) || [];

      // Game plan: prefer cloud version, fall back to local defaults
      const cloudGP = val(7);
      if (cloudGP && cloudGP.data && cloudGP.data.structures && cloudGP.data.months) {
        this.data.gameplan = cloudGP.data;
        this.data.gameplanMeta = {
          is_published: !!cloudGP.is_published,
          updated_by: cloudGP.updated_by,
          updated_at: cloudGP.updated_at
        };
      } else {
        // No cloud gameplan yet — use local/default and push it up once editor signs in
        this.data.gameplan = this.loadGamePlan();
        this.data.gameplanMeta = { is_published: false };
      }

      // Polls (admin list)
      this.data.polls = val(8) || [];
    } catch (err) {
      console.error('Failed to load from Supabase:', err);
      this.toast('Connection error — check your internet');
    }
  },

  // Refresh data from server (call after any mutation)
  async refresh() {
    await this.loadData();
    this.renderAll();
  },

  // ---- NAVIGATION ----
  setupNavigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(item.dataset.page);
      });
    });
  },

  navigate(page) {
    // Update nav
    document.querySelectorAll('.nav-item[data-page]').forEach(el => el.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Update page
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    // Update title
    const titles = {
      overview: 'Dashboard',
      checkin: 'Thursday Check-In',
      people: 'People Tracker',
      pipeline: 'Leadership Pipeline',
      followup: 'Follow-Up',
      retention: 'Retention & Growth',
      weekly: 'Weekly Prep',
      teams: 'Teams',
      groups: 'Microgroups',
      timeline: 'Launch Timeline',
      gameplan: 'Game Plan',
      polls: 'Polls',
      planner: 'Season Planner'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Re-render page-specific content
    this.renderAll();

    // Retention chart can only measure its canvas once the page is visible
    if (page === 'retention') {
      requestAnimationFrame(() => {
        this._drawAttendanceChart(this._retentionTimeline());
        this.renderGrowth();
      });
    }
    if (page === 'planner') requestAnimationFrame(() => this.renderPlanner());
  },

  setupMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    document.getElementById('mobileMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    });

    // Close sidebar when tapping overlay
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });

    // Close sidebar when navigating
    sidebar.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      });
    });
  },

  // ---- RENDER ALL ----
  renderAll() {
    this.renderMetrics();
    this.renderPeopleTable();
    this.renderPipeline();
    this.renderFollowups();
    this.renderTeams();
    this.renderGroups();
    this.renderWeeklyPrep();
    this.renderPastWeeks();
    this.renderCheckin();
    this.renderAttendanceHistory();
    this.renderPriorityGoals();
    this.renderAttendanceReport();
    this.renderGamePlan();
    this.renderPolls();
    this.renderRetention();
  },

  // ---- METRICS ----
  renderMetrics() {
    const people = this.data.people;
    document.getElementById('metricTotal').textContent = people.length;
    document.getElementById('metricConsistent').textContent =
      people.filter(p => ['consistent', 'core', 'leader'].includes(p.status)).length;
    document.getElementById('metricLeaders').textContent =
      people.filter(p => ['leader', 'core'].includes(p.status)).length;
    document.getElementById('metricGroups').textContent = this.data.groups.length;

    // Update nav badges
    document.getElementById('peopleBadge').textContent = people.length;

    const followups = this.getFollowupList();
    document.getElementById('followupBadge').textContent = followups.length;
    document.getElementById('followupCount').textContent = followups.length;
  },

  // ---- NEXT THURSDAY ----
  setNextThursday() {
    const now = new Date();
    const day = now.getDay();
    const daysUntilThursday = (4 - day + 7) % 7 || 7;
    const next = new Date(now);
    next.setDate(now.getDate() + (day === 4 && now.getHours() < 20 ? 0 : daysUntilThursday));
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('nextThursday').textContent = next.toLocaleDateString('en-US', options);
  },

  // ---- PEOPLE ----
  openPersonModal(id) {
    const modal = document.getElementById('personModal');
    if (id) {
      const person = this.data.people.find(p => p.id === id);
      if (!person) return;
      document.getElementById('personModalTitle').textContent = 'Edit Person';
      document.getElementById('personId').value = person.id;
      document.getElementById('personFirst').value = person.firstName;
      document.getElementById('personLast').value = person.lastName || '';
      document.getElementById('personPhone').value = person.phone || '';
      document.getElementById('personEmail').value = person.email || '';
      document.getElementById('personStatus').value = person.status;
      document.getElementById('personStage').value = person.stage;
      document.getElementById('personConnector').value = person.connector || '';
      document.getElementById('personNotes').value = person.notes || '';
    } else {
      document.getElementById('personModalTitle').textContent = 'Add Person';
      document.getElementById('personId').value = '';
      document.getElementById('personFirst').value = '';
      document.getElementById('personLast').value = '';
      document.getElementById('personPhone').value = '';
      document.getElementById('personEmail').value = '';
      document.getElementById('personStatus').value = 'new';
      document.getElementById('personStage').value = 'attending';
      document.getElementById('personConnector').value = '';
      document.getElementById('personNotes').value = '';
    }
    modal.classList.add('show');
  },

  async savePerson() {
    const firstName = document.getElementById('personFirst').value.trim();
    if (!firstName) { this.toast('First name is required'); return; }

    const id = document.getElementById('personId').value;
    const personData = {
      id: id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      firstName,
      lastName: document.getElementById('personLast').value.trim(),
      phone: document.getElementById('personPhone').value.trim(),
      email: document.getElementById('personEmail').value.trim(),
      status: document.getElementById('personStatus').value,
      stage: document.getElementById('personStage').value,
      connector: document.getElementById('personConnector').value.trim(),
      notes: document.getElementById('personNotes').value.trim(),
      lastAttended: id ? (this.data.people.find(p => p.id === id)?.lastAttended || '') : new Date().toISOString().split('T')[0],
      needsFollowup: id ? (this.data.people.find(p => p.id === id)?.needsFollowup || false) : true,
      followupDone: false,
      attendanceCount: id ? (this.data.people.find(p => p.id === id)?.attendanceCount || 0) : 0
    };

    await db.upsertPerson(personData);
    this.closeModal('personModal');
    await this.refresh();
    this.toast(id ? 'Person updated' : 'Person added');
  },

  async deletePerson(id) {
    if (!confirm('Remove this person?')) return;
    await db.deletePerson(id);
    await this.refresh();
    this.toast('Person removed');
  },

  renderPeopleTable() {
    const tbody = document.getElementById('peopleTableBody');
    const people = this.getFilteredPeople();

    if (people.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row"><td colspan="8">
          <div class="empty-state-large">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            <p>No people found</p>
            <button class="btn-primary-sm" onclick="app.openPersonModal()">Add Person</button>
          </div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = people.map(p => `
      <tr>
        <td><strong>${p.firstName} ${p.lastName || ''}</strong></td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <span>${p.phone || '—'}</span>
            ${p.phone ? `<a class="sms-btn" href="sms:${p.phone.replace(/\D/g,'')}" title="Text ${p.firstName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </a>` : ''}
          </div>
        </td>
        <td><span class="status-badge status-${p.status}">${this.capitalize(p.status)}</span></td>
        <td><span class="stage-badge">${this.capitalize(p.stage)}</span></td>
        <td>${p.connector || '—'}</td>
        <td>${p.lastAttended || '—'}</td>
        <td>${p.needsFollowup && !p.followupDone
          ? '<span style="color:var(--pink); font-weight:600;">Needed</span>'
          : '<span style="color:var(--teal);">Done</span>'}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn" onclick="app.openPersonModal('${p.id}')" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button class="table-action-btn delete" onclick="app.deletePerson('${p.id}')" title="Remove">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  filterPeople(searchVal) {
    this.renderPeopleTable();
  },

  getFilteredPeople() {
    let people = [...this.data.people];
    const search = (document.getElementById('peopleSearch')?.value || '').toLowerCase();
    const status = document.getElementById('statusFilter')?.value || '';

    if (search) {
      people = people.filter(p =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(search) ||
        (p.phone && p.phone.includes(search)) ||
        (p.connector && p.connector.toLowerCase().includes(search))
      );
    }
    if (status) {
      people = people.filter(p => p.status === status);
    }

    return people.sort((a, b) => a.firstName.localeCompare(b.firstName));
  },

  // ---- PIPELINE ----
  renderPipeline() {
    const stages = ['attending', 'connecting', 'serving', 'leading', 'multiplying'];
    stages.forEach(stage => {
      const people = this.data.people.filter(p => p.stage === stage);
      const container = document.getElementById(`pipeCards${this.capitalize(stage)}`);
      const count = document.getElementById(`pipe${this.capitalize(stage)}`);

      if (count) count.textContent = people.length;
      if (!container) return;

      if (people.length === 0) {
        container.innerHTML = '<p class="empty-state" style="padding:20px 0;">No one here yet</p>';
        return;
      }

      container.innerHTML = people.map(p => {
        const stageIdx = stages.indexOf(p.stage);
        const canMoveLeft = stageIdx > 0;
        const canMoveRight = stageIdx < stages.length - 1;
        return `
          <div class="pipeline-card" onclick="app.openPersonModal('${p.id}')">
            <div class="pipeline-card-name">${p.firstName} ${p.lastName || ''}</div>
            <div class="pipeline-card-meta">${this.capitalize(p.status)} · ${p.connector || 'No connector'}</div>
            <div class="pipeline-card-actions">
              ${canMoveLeft ? `<button class="pipe-move-btn" onclick="event.stopPropagation(); app.movePipeline('${p.id}', '${stages[stageIdx - 1]}')">&larr;</button>` : ''}
              ${canMoveRight ? `<button class="pipe-move-btn" onclick="event.stopPropagation(); app.movePipeline('${p.id}', '${stages[stageIdx + 1]}')">&rarr;</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    });
  },

  async movePipeline(id, newStage) {
    const person = this.data.people.find(p => p.id === id);
    if (person) {
      await db.updatePerson(id, { stage: newStage });
      person.stage = newStage;
      this.renderPipeline();
      this.toast(`Moved ${person.firstName} to ${this.capitalize(newStage)}`);
    }
  },

  // ---- FOLLOW-UPS ----
  getFollowupList() {
    return this.data.people.filter(p => p.needsFollowup && !p.followupDone);
  },

  renderFollowups() {
    const list = this.getFollowupList();
    const assignOptions = this.teamMembers.map(m =>
      `<option value="${m}">${m}</option>`
    ).join('');

    const sendTextBtn = (p) => {
      if (!p.phone) {
        return `<button class="followup-text-btn disabled" title="No phone number on file" onclick="app.toast('No phone number on file for ${p.firstName.replace(/'/g,"\\'")}.')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          No #
        </button>`;
      }
      return `<button class="followup-text-btn" onclick="app.sendFollowupText('${p.id}')" title="Opens your SMS app with a pre-written message">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Send Text
      </button>`;
    };

    // Main followup page
    const mainList = document.getElementById('followupList');
    if (mainList) {
      if (list.length === 0) {
        mainList.innerHTML = '<p class="empty-state">Everyone is followed up! Nice work.</p>';
      } else {
        mainList.innerHTML = list.map(p => `
          <div class="followup-item">
            <div class="followup-item-info">
              <span class="followup-item-name">${p.firstName} ${p.lastName || ''}</span>
              <span class="followup-item-reason">${p.status === 'new' ? 'New person — follow up within 24hrs' : 'Needs check-in'}${p.phone ? ' · ' + p.phone : ''}</span>
            </div>
            <div class="followup-item-actions">
              <select class="followup-assign" onchange="app.assignFollowup('${p.id}', this.value)" title="Assign to">
                <option value="">Assign to...</option>
                ${assignOptions}
              </select>
              ${sendTextBtn(p)}
              <button class="followup-done-btn" onclick="app.markFollowedUp('${p.id}')">Done</button>
            </div>
          </div>
        `).join('');

        // Set current assignments
        list.forEach(p => {
          if (p.followupAssignedTo) {
            const select = mainList.querySelector(`select[onchange*="${p.id}"]`);
            if (select) select.value = p.followupAssignedTo;
          }
        });
      }
    }

    // Overview preview
    const preview = document.getElementById('overviewFollowups');
    if (preview) {
      if (list.length === 0) {
        preview.innerHTML = '<p class="empty-state">No follow-ups needed right now.</p>';
      } else {
        preview.innerHTML = list.slice(0, 5).map(p => `
          <div class="followup-item">
            <div class="followup-item-info">
              <span class="followup-item-name">${p.firstName} ${p.lastName || ''}</span>
              <span class="followup-item-reason">${p.followupAssignedTo ? '<strong>' + p.followupAssignedTo + '</strong> · ' : ''}${p.status === 'new' ? 'New — 24hr follow-up' : 'Check-in'}</span>
            </div>
            <div class="followup-item-actions">
              ${sendTextBtn(p)}
              <button class="followup-done-btn" onclick="app.markFollowedUp('${p.id}')">Done</button>
            </div>
          </div>
        `).join('');
      }
    }
  },

  // Send a pre-written follow-up text via the native SMS app
  sendFollowupText(id) {
    const person = this.data.people.find(p => p.id === id);
    if (!person) return;
    if (!person.phone) {
      this.toast(`No phone number on file for ${person.firstName}.`);
      return;
    }

    // Pick template based on person status
    const type = person.status === 'new' ? 'new' : 'checkin';
    const body = Generators.getText(type, person.firstName);

    // Native SMS URL scheme — works on iOS/Android, and on macOS via Messages app.
    // iOS wants `&body=`, Android wants `?body=`. Using `?` is the safest for both.
    const phone = person.phone.replace(/[^\d+]/g, '');
    const url = `sms:${phone}?&body=${encodeURIComponent(body)}`;

    // Open SMS app
    window.location.href = url;

    // Optimistically mark the follow-up as reached out so the list shrinks.
    // Also drop a record on the `_reachedOut` map for audit.
    this._reachedOut[id] = {
      at: new Date().toISOString(),
      method: 'sms',
      body
    };
    try { localStorage.setItem('stpete_reached_out', JSON.stringify(this._reachedOut)); } catch (e) {}

    // Mark followed up in DB + state
    this.markFollowedUp(id);
    this.toast(`Text drafted for ${person.firstName}. Hit send in your Messages app.`);
  },

  async assignFollowup(personId, assignee) {
    const person = this.data.people.find(p => p.id === personId);
    if (person) {
      await db.updatePerson(personId, { followupAssignedTo: assignee });
      person.followupAssignedTo = assignee;
      this.toast(assignee ? `Assigned ${person.firstName} to ${assignee}` : `Unassigned ${person.firstName}`);
    }
  },

  async markFollowedUp(id) {
    const person = this.data.people.find(p => p.id === id);
    if (person) {
      await db.updatePerson(id, { followupDone: true, needsFollowup: false });
      person.followupDone = true;
      person.needsFollowup = false;
      this.renderAll();
      this.toast(`Followed up with ${person.firstName}`);
    }
  },

  async markAllFollowedUp() {
    const promises = this.data.people
      .filter(p => p.needsFollowup)
      .map(p => db.updatePerson(p.id, { followupDone: true, needsFollowup: false }));
    await Promise.all(promises);
    await this.refresh();
    this.toast('All follow-ups marked done');
  },

  // ---- WEEKLY PREP ----
  _saveTimeout: null,
  saveWeeklyPrep() {
    // Debounce saves to avoid hammering the DB on every keystroke
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => this._doSaveWeeklyPrep(), 800);
  },

  async _doSaveWeeklyPrep() {
    // Collect editable questions from textarea
    const questionsTA = document.getElementById('questionsTextarea');
    let questions = this.data.weeklyPrep?.questions || [];
    if (questionsTA && questionsTA.value.trim()) {
      questions = questionsTA.value.trim().split('\n').map(q => q.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    }

    // Icebreaker now comes from an editable textarea
    const icebreakerTA = document.getElementById('weekIcebreaker');
    const icebreaker = icebreakerTA
      ? icebreakerTA.value
      : (this.data.weeklyPrep?.icebreaker || '');

    const nightType = document.getElementById('weekNightType')?.value
      || this.data.weeklyPrep?.night_type
      || 'community';

    const flow = Array.isArray(this.data.weeklyPrep?.flow) ? this.data.weeklyPrep.flow : [];
    const cardOrder = Array.isArray(this.data.weeklyPrep?.card_order)
      ? this.data.weeklyPrep.card_order
      : ['icebreaker', 'questions', 'schedule', 'cta'];

    const prep = {
      id: this.data.weeklyPrep?.id || undefined,
      topic: document.getElementById('weekTopic')?.value || '',
      scripture: document.getElementById('weekScripture')?.value || '',
      takeaway: document.getElementById('weekTakeaway')?.value || '',
      cta: document.getElementById('weekCTA')?.value || '',
      icebreaker,
      questions,
      message_notes: document.getElementById('weekMessageNotes')?.value || '',
      night_type: nightType,
      flow,
      card_order: cardOrder,
      is_published: this.data.weeklyPrep?.is_published || false
    };

    const result = await db.upsertWeeklyPrep(prep);
    if (result && result[0]) {
      this.data.weeklyPrep = result[0];
    }

    const topicEl = document.getElementById('weeklyTopic');
    if (topicEl && prep.topic) topicEl.textContent = prep.topic;

    const labelEl = document.getElementById('currentWeekLabel');
    if (labelEl) labelEl.textContent = prep.topic || "Set this week's topic below";
  },

  renderWeeklyPrep() {
    const wp = this.data.weeklyPrep || {};
    const topicInput = document.getElementById('weekTopic');
    if (topicInput) topicInput.value = wp.topic || '';
    const scriptInput = document.getElementById('weekScripture');
    if (scriptInput) scriptInput.value = wp.scripture || '';
    const takeInput = document.getElementById('weekTakeaway');
    if (takeInput) takeInput.value = wp.takeaway || '';
    const ctaInput = document.getElementById('weekCTA');
    if (ctaInput) ctaInput.value = wp.cta || '';
    const notesInput = document.getElementById('weekMessageNotes');
    if (notesInput) notesInput.value = wp.message_notes || '';

    // Restore saved questions into textarea
    const qTA = document.getElementById('questionsTextarea');
    if (qTA && wp.questions && wp.questions.length > 0 && !qTA.dataset.userEdited) {
      qTA.value = wp.questions.map((q, i) => `${i+1}. ${q}`).join('\n');
    }

    // Restore saved icebreaker into editable textarea
    const ibTA = document.getElementById('weekIcebreaker');
    if (ibTA && !ibTA.dataset.userEdited) {
      ibTA.value = wp.icebreaker || '';
    }

    const topicEl = document.getElementById('weeklyTopic');
    if (topicEl) {
      topicEl.textContent = wp.topic || 'Set this week\'s topic in Weekly Prep';
    }

    const labelEl = document.getElementById('currentWeekLabel');
    if (labelEl) labelEl.textContent = wp.topic || "Set this week's topic below";

    // Populate night type dropdown from game plan structures
    const ntSel = document.getElementById('weekNightType');
    if (ntSel) {
      const structures = this.data.gameplan?.structures || [];
      ntSel.innerHTML = structures
        .map(s => `<option value="${s.type}">${s.name || s.type}</option>`)
        .join('') || '<option value="community">Community Night</option>';
      ntSel.value = wp.night_type || structures[0]?.type || 'community';
    }

    // Default the flow from the structure template if none saved
    if (!wp.flow || wp.flow.length === 0) {
      const struct = (this.data.gameplan?.structures || [])
        .find(s => s.type === (wp.night_type || 'community'));
      if (struct && Array.isArray(struct.times)) {
        // Copy the template into the working prep object (not saved until user edits)
        this.data.weeklyPrep = this.data.weeklyPrep || {};
        this.data.weeklyPrep.flow = struct.times.map(t => ({
          time: t.label || '',
          desc: t.desc || ''
        }));
      }
    }

    this.renderWeeklyFlowEditor();
    this.renderCardOrder();

    // Update publish button state
    const pubBtn = document.getElementById('publishBtn');
    if (pubBtn) {
      if (wp.is_published) {
        pubBtn.textContent = 'Published ✓ — Update';
        pubBtn.classList.add('published');
      } else {
        pubBtn.textContent = 'Publish to Public Site';
        pubBtn.classList.remove('published');
      }
    }
  },

  // ---- WEEKLY FLOW EDITOR ----
  renderWeeklyFlowEditor() {
    const container = document.getElementById('weeklyFlowEditor');
    if (!container) return;
    const flow = this.data.weeklyPrep?.flow || [];
    if (flow.length === 0) {
      container.innerHTML = '<p class="empty-state" style="padding:12px 0;">No flow rows yet. Pick a night type above, or click + Add Row.</p>';
      return;
    }
    container.innerHTML = flow.map((row, idx) => `
      <div style="display:grid;grid-template-columns:110px 1fr auto;gap:10px;align-items:center;margin-bottom:8px;">
        <input type="text" value="${this._escAttr(row.time || '')}" placeholder="Time"
          oninput="app.updateWeeklyFlowRow(${idx}, 'time', this.value)"
          style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:0.88rem;font-weight:600;color:var(--slate);">
        <input type="text" value="${this._escAttr(row.desc || '')}" placeholder="What's happening at this time..."
          oninput="app.updateWeeklyFlowRow(${idx}, 'desc', this.value)"
          style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:0.88rem;color:var(--slate);">
        <button class="btn-ghost" onclick="app.removeWeeklyFlowRow(${idx})" aria-label="Remove row"
          style="padding:8px 12px;font-size:0.8rem;color:var(--pink);">×</button>
      </div>
    `).join('');
  },

  _escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  changeWeeklyNightType(type) {
    this.data.weeklyPrep = this.data.weeklyPrep || {};
    this.data.weeklyPrep.night_type = type;
    const struct = (this.data.gameplan?.structures || []).find(s => s.type === type);
    if (struct && Array.isArray(struct.times)) {
      this.data.weeklyPrep.flow = struct.times.map(t => ({
        time: t.label || '',
        desc: t.desc || ''
      }));
    }
    this.renderWeeklyFlowEditor();
    this._doSaveWeeklyPrep();
  },

  addWeeklyFlowRow() {
    this.data.weeklyPrep = this.data.weeklyPrep || {};
    this.data.weeklyPrep.flow = this.data.weeklyPrep.flow || [];
    this.data.weeklyPrep.flow.push({ time: '', desc: '' });
    this.renderWeeklyFlowEditor();
    this.saveWeeklyPrep();
  },

  removeWeeklyFlowRow(idx) {
    if (!this.data.weeklyPrep?.flow) return;
    this.data.weeklyPrep.flow.splice(idx, 1);
    this.renderWeeklyFlowEditor();
    this.saveWeeklyPrep();
  },

  updateWeeklyFlowRow(idx, field, value) {
    if (!this.data.weeklyPrep?.flow?.[idx]) return;
    this.data.weeklyPrep.flow[idx][field] = value;
    this.saveWeeklyPrep();
  },

  resetWeeklyFlowToDefault() {
    const type = document.getElementById('weekNightType')?.value
      || this.data.weeklyPrep?.night_type
      || 'community';
    this.changeWeeklyNightType(type);
    this.toast('Flow reset to default template');
  },

  // ---- CARD ORDER ----
  _CARD_DEFS: {
    icebreaker: { label: 'Icebreaker', sub: 'Connection question shown at the top' },
    questions:  { label: 'Discussion Questions', sub: 'Table questions for small group time' },
    schedule:   { label: "Tonight's Schedule", sub: 'Night flow timeline' },
    cta:        { label: 'Ownership Moment', sub: 'Call-to-action / next step card' },
  },

  _getCardOrder() {
    const saved = this.data.weeklyPrep?.card_order;
    const defaults = ['icebreaker', 'questions', 'schedule', 'cta'];
    if (!Array.isArray(saved) || saved.length === 0) return [...defaults];
    // Ensure all defaults are present (add missing at end), remove unknown
    const known = new Set(Object.keys(this._CARD_DEFS));
    const ordered = saved.filter(k => known.has(k));
    defaults.forEach(k => { if (!ordered.includes(k)) ordered.push(k); });
    return ordered;
  },

  renderCardOrder() {
    const container = document.getElementById('cardOrderList');
    if (!container) return;
    const order = this._getCardOrder();

    container.innerHTML = order.map((id, idx) => {
      const def = this._CARD_DEFS[id] || { label: id, sub: '' };
      const isFirst = idx === 0;
      const isLast = idx === order.length - 1;
      return `
        <div class="card-order-row" draggable="true"
             data-card-id="${id}"
             ondragstart="app._cardDragStart(event,'${id}')"
             ondragover="app._cardDragOver(event)"
             ondragleave="app._cardDragLeave(event)"
             ondrop="app._cardDrop(event,'${id}')">
          <div class="card-order-drag">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/>
              <circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>
              <circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>
            </svg>
          </div>
          <div class="card-order-label">
            <div>${this.escapeHtml(def.label)}</div>
            <div class="card-order-sub">${this.escapeHtml(def.sub)}</div>
          </div>
          <div class="card-order-arrows">
            <button class="card-order-arrow" onclick="app.moveCard('${id}',-1)" ${isFirst ? 'disabled' : ''} title="Move up">▲</button>
            <button class="card-order-arrow" onclick="app.moveCard('${id}', 1)" ${isLast ? 'disabled' : ''} title="Move down">▼</button>
          </div>
        </div>`;
    }).join('');
  },

  moveCard(id, dir) {
    const order = this._getCardOrder();
    const idx = order.indexOf(id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= order.length) return;
    order.splice(idx, 1);
    order.splice(newIdx, 0, id);
    this.data.weeklyPrep = this.data.weeklyPrep || {};
    this.data.weeklyPrep.card_order = order;
    this.renderCardOrder();
    this.saveWeeklyPrep();
  },

  // Drag-and-drop helpers
  _cardDragStart(e, id) {
    e.dataTransfer.setData('card-id', id);
    e.currentTarget.classList.add('dragging');
  },
  _cardDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  },
  _cardDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  },
  _cardDrop(e, targetId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const dragId = e.dataTransfer.getData('card-id');
    if (!dragId || dragId === targetId) return;
    const order = this._getCardOrder();
    const fromIdx = order.indexOf(dragId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragId);
    this.data.weeklyPrep = this.data.weeklyPrep || {};
    this.data.weeklyPrep.card_order = order;
    this.renderCardOrder();
    this.saveWeeklyPrep();
    // Clean up dragging class from any row
    document.querySelectorAll('.card-order-row.dragging')
      .forEach(el => el.classList.remove('dragging'));
  },

  async generateIcebreaker() {
    const icebreaker = Generators.getIcebreaker();
    const ta = document.getElementById('weekIcebreaker');
    if (ta) {
      ta.value = icebreaker;
      ta.dataset.userEdited = '1';
    }
    if (this.data.weeklyPrep) this.data.weeklyPrep.icebreaker = icebreaker;
    this._doSaveWeeklyPrep();
  },

  async generateQuestions() {
    const topic = (this.data.weeklyPrep?.topic || document.getElementById('weekTopic')?.value || '').toLowerCase();
    let theme = 'general';
    const themes = Generators.getThemes();
    for (const t of themes) {
      if (topic.includes(t)) { theme = t; break; }
    }

    const questions = Generators.getQuestions(theme, 5);
    const qTA = document.getElementById('questionsTextarea');
    if (qTA) {
      qTA.value = questions.map((q, i) => `${i+1}. ${q}`).join('\n');
      qTA.dataset.userEdited = '';
    }

    if (this.data.weeklyPrep) this.data.weeklyPrep.questions = questions;
    this._doSaveWeeklyPrep();

    const qCount = document.getElementById('weeklyQCount');
    if (qCount) qCount.textContent = `${questions.length} questions ready`;
  },

  async publishWeeklyPrep() {
    const topic = document.getElementById('weekTopic')?.value || '';
    if (!topic) { this.toast('Add a topic before publishing'); return; }

    // Save first to capture any unsaved edits
    await this._doSaveWeeklyPrep();

    // Set is_published = true
    if (this.data.weeklyPrep?.id) {
      await db.updateWeeklyPrepPublished(this.data.weeklyPrep.id, true);
      this.data.weeklyPrep.is_published = true;
    }

    this.renderWeeklyPrep();
    this.toast('Published! Share the link below.');

    // Show the share section
    const shareSection = document.getElementById('publishedLinks');
    if (shareSection) shareSection.classList.add('show');
  },

  // ---- TEXT GENERATOR ----
  generateText() {
    const type = document.getElementById('textType').value;
    const name = document.getElementById('textName').value.trim();
    const output = document.getElementById('generatedText');

    if (!name) {
      output.innerHTML = '<p class="placeholder-text">Enter a name to generate a message...</p>';
      return;
    }

    const text = Generators.getText(type, name);
    output.innerHTML = `<p style="color:var(--slate); line-height:1.7;">${text}</p>`;
  },

  copyText() {
    const output = document.getElementById('generatedText');
    const text = output.innerText;
    if (!text || text.includes('Enter a name') || text.includes('Select a type')) {
      this.toast('Generate a message first');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      this.toast('Copied to clipboard!');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.toast('Copied to clipboard!');
    });
  },

  // ---- PAST WEEKS ----
  async startNewWeek() {
    const wp = this.data.weeklyPrep || {};
    if (!wp.topic && !wp.scripture && !wp.takeaway) {
      this.toast('Nothing to archive yet — add a topic first');
      return;
    }
    const label = wp.topic || 'this week';
    if (!confirm(`Archive "${label}" to Past Weeks and start a fresh week? The current prep will be saved to the archive, and a blank week will be created.`)) return;

    // 1) Make sure every pending field edit is persisted to the current row.
    await this._doSaveWeeklyPrep();

    // 2) Insert a brand-new blank weekly_prep row. upsertWeeklyPrep auto-flips
    //    every existing is_current=true row to is_current=false before inserting,
    //    which is exactly what we want for archiving.
    const fresh = {
      // no id -> triggers the archive-and-insert path
      topic: '',
      scripture: '',
      takeaway: '',
      cta: '',
      icebreaker: '',
      questions: [],
      message_notes: '',
      night_type: wp.night_type || 'community',
      flow: [],
      is_published: false
    };
    const created = await db.upsertWeeklyPrep(fresh);
    this.data.weeklyPrep = (created && created[0]) ? created[0] : fresh;

    // Clear any user-edited markers + input values for the blank week
    const qTA = document.getElementById('questionsTextarea');
    if (qTA) { qTA.value = ''; qTA.dataset.userEdited = ''; }
    const ibTA = document.getElementById('weekIcebreaker');
    if (ibTA) { ibTA.value = ''; ibTA.dataset.userEdited = ''; }

    // 3) Reload past weeks from DB so the archived one appears in the archive card.
    this.data.pastWeeks = (await db.getPastWeeks()) || [];
    this.renderWeeklyPrep();
    this.renderPastWeeks();
    this.toast(`Archived "${label}" — fresh week ready`);
  },

  renderPastWeeks() {
    const container = document.getElementById('pastWeeks');
    if (!container) return;

    if (!this.data.pastWeeks || this.data.pastWeeks.length === 0) {
      container.innerHTML = '<p class="empty-state">Past week preps will appear here after you click New Week.</p>';
      return;
    }

    container.innerHTML = this.data.pastWeeks.map(w => {
      const date = w.date || (w.created_at ? w.created_at.split('T')[0] : '');
      const topic = w.topic || 'Untitled';
      const scripture = w.scripture || 'No scripture';
      const qCount = Array.isArray(w.questions) ? w.questions.length : 0;
      return `
        <div class="past-week-item">
          <div class="past-week-item-info">
            <span class="past-week-item-topic">${this._escAttr(topic)}</span>
            <span class="past-week-item-date">${date} · ${this._escAttr(scripture)}${qCount ? ` · ${qCount} questions` : ''}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  // ---- TEAMS ----
  renderTeams() {
    const grid = document.getElementById('teamsGrid');
    if (!grid) return;

    const teams = this.data.teams;
    const members = this.data.teamMembersData;

    let html = teams.map(team => {
      const teamMembers = members.filter(m => m.team_id === team.id);
      return `
        <div class="team-card">
          <div class="team-card-header">
            <h3>${team.name}</h3>
            <span class="team-card-count">${teamMembers.length}</span>
          </div>
          <div class="team-card-body">
            <p style="font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;">${team.description}</p>
            ${teamMembers.map(m => `
              <div class="team-member">
                <span class="team-member-name">${m.name}</span>
                <span class="team-member-role">${m.role || 'Member'}</span>
              </div>
            `).join('')}
            <button class="team-add-btn" onclick="app.addTeamMember('${team.id}')">+ Add Member</button>
          </div>
        </div>
      `;
    }).join('');

    grid.innerHTML = html;

    // Render Team Roles card (admin/owner only)
    this.renderTeamRoles();
  },

  async renderTeamRoles() {
    const container = document.getElementById('teamRolesCard');
    if (!container) return;

    if (!this.hasMinRole('admin')) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    const roles = await db.getTeamRoles();
    const ROLE_OPTIONS = ['leader', 'editor', 'admin', 'owner'];
    const myRole = this.currentUser?.dbRole || 'editor';
    const isOwner = myRole === 'owner';

    container.innerHTML = `
      <div class="card" style="margin-top:24px;">
        <div class="card-header">
          <h3>Team Roles</h3>
          <span style="font-size:0.75rem; color:var(--gray-500); font-weight:500;">Manage access levels</span>
        </div>
        <div class="card-body">
          ${roles.map(r => {
            const isSelf = r.user_id === this.currentUser?.userId;
            const isTargetOwner = r.role === 'owner';
            // Admins cannot change owners or themselves; owners can change anyone except themselves
            const canEdit = isOwner ? !isSelf : (!isTargetOwner && !isSelf);
            return `
              <div class="team-member" style="padding:10px 0; border-bottom:1px solid var(--gray-100);">
                <div>
                  <span class="team-member-name">${r.full_name}</span>
                  ${isSelf ? '<span style="font-size:0.7rem; color:var(--teal-dark); font-weight:700; margin-left:6px;">YOU</span>' : ''}
                </div>
                ${canEdit ? `
                  <select class="role-select" onchange="app.updateMemberRole('${r.user_id}', this.value)"
                    style="padding:4px 8px; border:1px solid var(--border); border-radius:6px; font-size:0.8rem; color:var(--slate); background:white; cursor:pointer;">
                    ${ROLE_OPTIONS.filter(opt => isOwner || opt !== 'owner').map(opt =>
                      `<option value="${opt}" ${r.role === opt ? 'selected' : ''}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`
                    ).join('')}
                  </select>
                ` : `<span class="role-badge role-badge-${r.role}">${r.role}</span>`}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  async updateMemberRole(userId, newRole) {
    await db.updateTeamRole(userId, newRole);
    this.toast(`Role updated`);
    this.renderTeamRoles();
  },

  async addTeamMember(teamKey) {
    const name = prompt('Person\'s name:');
    if (!name) return;
    const role = prompt('Role (optional):') || 'Member';

    await db.addTeamMember(teamKey, name.trim(), role.trim());
    const team = this.data.teams.find(t => t.id === teamKey);
    await this.refresh();
    this.toast(`Added ${name.trim()} to ${team?.name || teamKey}`);
  },

  // ---- MICROGROUPS ----
  openGroupModal() {
    document.getElementById('groupName').value = '';
    document.getElementById('groupType').value = 'mixed';
    document.getElementById('groupLeader').value = '';
    document.getElementById('groupDay').value = '';
    document.getElementById('groupLocation').value = '';
    document.getElementById('groupDesc').value = '';
    document.getElementById('groupModal').classList.add('show');
  },

  async saveGroup() {
    const name = document.getElementById('groupName').value.trim();
    if (!name) { this.toast('Group name is required'); return; }

    await db.createGroup({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name,
      type: document.getElementById('groupType').value,
      leader: document.getElementById('groupLeader').value.trim(),
      day: document.getElementById('groupDay').value,
      location: document.getElementById('groupLocation').value.trim(),
      description: document.getElementById('groupDesc').value.trim()
    });

    this.closeModal('groupModal');
    await this.refresh();
    this.toast('Microgroup created');
  },

  renderGroups() {
    const grid = document.getElementById('groupsGrid');
    if (!grid) return;

    if (this.data.groups.length === 0) {
      grid.innerHTML = `
        <div class="empty-state-large">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/></svg>
          <p>No microgroups yet</p>
          <p class="sub">Break the 40-person ceiling by moving relationships into the week.</p>
          <button class="btn-primary-sm" onclick="app.openGroupModal()">Create First Group</button>
        </div>`;
      return;
    }

    const typeLabels = {
      mens: "Men's", womens: "Women's", youngadults: 'Young Adults',
      interest: 'Interest-Based', neighborhood: 'Neighborhood', mixed: 'Mixed'
    };

    grid.innerHTML = this.data.groups.map(g => `
      <div class="group-card">
        <div class="group-card-type">${typeLabels[g.type] || g.type}</div>
        <h3>${g.name}</h3>
        <div class="group-card-meta">
          ${g.leader ? `<strong>Leader:</strong> ${g.leader}<br>` : ''}
          ${g.day ? `<strong>Day:</strong> ${g.day}<br>` : ''}
          ${g.location ? `<strong>Location:</strong> ${g.location}<br>` : ''}
          ${g.description ? `<br>${g.description}` : ''}
        </div>
      </div>
    `).join('');
  },

  // ---- CHECK-IN ----
  renderCheckin() {
    const list = document.getElementById('checkinList');
    if (!list) return;

    const people = this.data.people;
    if (people.length === 0) {
      list.innerHTML = '<p class="empty-state" style="padding:40px;">Add people first to start checking in.</p>';
      this.updateCheckinStats();
      return;
    }

    const search = (document.getElementById('checkinSearch')?.value || '').toLowerCase();
    let filtered = [...people].sort((a, b) => a.firstName.localeCompare(b.firstName));

    if (search) {
      filtered = filtered.filter(p =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(search)
      );
    }

    // Split into unchecked and checked
    const unchecked = filtered.filter(p => !this.data.checkinState[p.id]);
    const checked = filtered.filter(p => this.data.checkinState[p.id]);

    const renderRow = (p) => {
      const isChecked = this.data.checkinState[p.id] || false;
      const streak = this.getAttendanceStreak(p.id);
      const streakClass = streak >= 4 ? 'streak-hot' : streak >= 2 ? 'streak-warm' : streak === 0 && this.data.attendance.length > 0 ? 'streak-cold' : '';
      const streakLabel = streak >= 4 ? `${streak}🔥` : streak >= 2 ? `${streak} wks` : streak === 0 && this.data.attendance.length > 0 ? 'Not recent' : '';

      return `
        <div class="checkin-row ${isChecked ? 'checked' : ''}">
          <div class="checkin-info" onclick="app.toggleCheckin('${p.id}')">
            <span class="checkin-name">${p.firstName} ${p.lastName || ''}</span>
            <span class="checkin-meta">${this.capitalize(p.status)}${p.connector ? ' · via ' + p.connector : ''}${streakLabel ? ' · ' + streakLabel : ''}</span>
          </div>
          <button class="checkin-btn ${isChecked ? 'checkin-btn-done' : 'checkin-btn-go'}" onclick="app.toggleCheckin('${p.id}')">
            ${isChecked
              ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Here'
              : 'Check In'}
          </button>
        </div>
      `;
    };

    let html = '';
    if (unchecked.length > 0) {
      html += unchecked.map(renderRow).join('');
    }
    if (checked.length > 0) {
      html += `<div class="checkin-section-divider">Checked In (${checked.length})</div>`;
      html += checked.map(renderRow).join('');
    }
    list.innerHTML = html || '<p class="empty-state" style="padding:40px;">No people match your search.</p>';

    this.updateCheckinStats();

    // Update checkin date
    const dateEl = document.getElementById('checkinDate');
    if (dateEl) {
      const now = new Date();
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      dateEl.textContent = `${now.toLocaleDateString('en-US', options)} Check-In`;
    }
  },

  toggleCheckin(id) {
    this.data.checkinState[id] = !this.data.checkinState[id];
    this.renderCheckin();
    this._autoSaveCheckin();
  },

  _autoSaveTimer: null,
  _autoSaveCheckin() {
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => this._doAutoSave(), 500);
  },

  async _doAutoSave() {
    const checkedIds = Object.entries(this.data.checkinState)
      .filter(([, v]) => v)
      .map(([id]) => id);
    const today = new Date().toISOString().split('T')[0];
    const newCount = this.data.people.filter(p =>
      checkedIds.includes(p.id) && p.status === 'new'
    ).length;
    await db.upsertAttendance({
      date: today,
      checkedIn: checkedIds,
      total: this.data.people.length,
      newPeople: newCount
    });
  },

  uncheckAll() {
    this.data.checkinState = {};
    this.renderCheckin();
    this.toast('All check-ins reset');
  },

  updateCheckinStats() {
    const checked = Object.values(this.data.checkinState).filter(Boolean).length;
    const checkinPresent = document.getElementById('checkinPresent');
    const checkinNew = document.getElementById('checkinNew');
    const checkinTotal = document.getElementById('checkinTotal');
    const badge = document.getElementById('checkinCountBadge');

    if (checkinPresent) checkinPresent.textContent = checked;
    if (checkinTotal) checkinTotal.textContent = this.data.people.length;
    if (badge) badge.textContent = `${checked} checked in`;

    // Count new people checked in
    if (checkinNew) {
      const newChecked = this.data.people.filter(p =>
        this.data.checkinState[p.id] && p.status === 'new'
      ).length;
      checkinNew.textContent = newChecked;
    }
  },

  async saveAttendance() {
    const checkedIds = Object.entries(this.data.checkinState)
      .filter(([, v]) => v)
      .map(([id]) => id);

    if (checkedIds.length === 0) {
      this.toast('No one checked in yet');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const newCount = this.data.people.filter(p =>
      checkedIds.includes(p.id) && p.status === 'new'
    ).length;

    // Save attendance record
    await db.upsertAttendance({
      date: today,
      checkedIn: checkedIds,
      total: this.data.people.length,
      newPeople: newCount
    });

    // Update people who were checked in
    const updatePromises = checkedIds.map(id => {
      const person = this.data.people.find(p => p.id === id);
      if (person) {
        return db.updatePerson(id, {
          lastAttended: today,
          attendanceCount: (person.attendanceCount || 0) + 1
        });
      }
    }).filter(Boolean);

    // Auto-flag absent consistent people
    const flagPromises = this.data.people
      .filter(p => !checkedIds.includes(p.id) && ['consistent', 'core', 'leader'].includes(p.status))
      .map(p => db.updatePerson(p.id, { needsFollowup: true, followupDone: false }));

    await Promise.all([...updatePromises, ...flagPromises]);
    await this.refresh();
    this.toast(`Saved! ${checkedIds.length} people checked in`);
  },

  getAttendanceStreak(personId) {
    let streak = 0;
    const sorted = [...this.data.attendance].sort((a, b) => b.date.localeCompare(a.date));
    for (const record of sorted) {
      if (record.checkedIn.includes(personId)) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  },

  renderAttendanceHistory() {
    const container = document.getElementById('attendanceHistory');
    if (!container) return;

    if (this.data.attendance.length === 0) {
      container.innerHTML = '<p class="empty-state">No attendance records yet. Save your first check-in above.</p>';
      return;
    }

    container.innerHTML = this.data.attendance.slice(0, 20).map((record, idx) => {
      const date = new Date(record.date + 'T12:00:00');
      const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const pct = record.total > 0 ? Math.round((record.checkedIn.length / record.total) * 100) : 0;

      return `
        <div class="attendance-record clickable" onclick="app.showAttendanceDetail(${idx})" title="Click to see who was there">
          <span class="attendance-record-date">${dateStr}</span>
          <div class="attendance-record-stats">
            <span class="attendance-record-stat"><strong>${record.checkedIn.length}</strong> present</span>
            <span class="attendance-record-stat">${record.newPeople || 0} new</span>
            <span class="attendance-record-stat">${pct}% of ${record.total}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      `;
    }).join('');
  },

  // Holds state while the attendance detail modal is open
  attendanceEdit: null, // { date, checkedIn: Set, newPeople, editMode }

  showAttendanceDetail(idx) {
    const record = this.data.attendance[idx];
    if (!record) return;

    this.attendanceEdit = {
      date: record.date,
      checkedIn: new Set(record.checkedIn),
      newPeople: record.newPeople || 0,
      total: record.total || 0,
      editMode: false,
      originalIdx: idx
    };

    this.renderAttendanceDetail();
    document.getElementById('attendanceModal').classList.add('show');
  },

  renderAttendanceDetail() {
    const edit = this.attendanceEdit;
    if (!edit) return;

    const date = new Date(edit.date + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('attendanceModalTitle').textContent = dateStr;

    const canEdit = this.hasMinRole('editor');
    const presentCount = edit.checkedIn.size;
    const pct = edit.total > 0 ? Math.round((presentCount / edit.total) * 100) : 0;

    // Stats + action bar
    const btnBase = 'padding:8px 16px; border-radius:8px; font-size:0.8rem; font-weight:700; cursor:pointer; border:none; font-family:inherit;';
    const btnPrimary = btnBase + ' background:var(--teal); color:white;';
    const btnDanger = btnBase + ' background:#FEE2E2; color:#B91C1C;';
    const btnGhostInline = btnBase + ' background:var(--gray-100); color:var(--gray-600);';

    const actionsHtml = canEdit ? (edit.editMode ? `
      <div style="display:flex; gap:8px; padding:12px 24px; background:white; border-top:1px solid var(--border); justify-content:flex-end;">
        <button style="${btnGhostInline}" onclick="app.cancelAttendanceEdit()">Cancel</button>
        <button style="${btnPrimary}" onclick="app.saveAttendanceEdit()">Save Changes</button>
      </div>
    ` : `
      <div style="display:flex; gap:8px; padding:12px 24px; background:white; border-top:1px solid var(--border); justify-content:flex-end;">
        <button style="${btnDanger}" onclick="app.deleteAttendanceRecord()">Delete</button>
        <button style="${btnPrimary}" onclick="app.toggleAttendanceEditMode()">Edit Check-ins</button>
      </div>
    `) : '';

    document.getElementById('attendanceDetailStats').innerHTML = `
      <div style="display:flex; gap:24px; padding:16px 24px; background:var(--gray-100); justify-content:center;">
        <div style="text-align:center;"><strong style="font-size:1.3rem; color:var(--teal-dark);">${presentCount}</strong><br><span style="font-size:0.72rem; color:var(--gray-500); text-transform:uppercase; font-weight:600;">Present</span></div>
        <div style="text-align:center;"><strong style="font-size:1.3rem; color:var(--pink);">${edit.newPeople || 0}</strong><br><span style="font-size:0.72rem; color:var(--gray-500); text-transform:uppercase; font-weight:600;">New</span></div>
        <div style="text-align:center;"><strong style="font-size:1.3rem; color:var(--gold);">${pct}%</strong><br><span style="font-size:0.72rem; color:var(--gray-500); text-transform:uppercase; font-weight:600;">of ${edit.total}</span></div>
      </div>
      ${actionsHtml}
    `;

    // People lists
    const present = this.data.people
      .filter(p => edit.checkedIn.has(p.id))
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
    const absent = this.data.people
      .filter(p => !edit.checkedIn.has(p.id))
      .sort((a, b) => a.firstName.localeCompare(b.firstName));

    const clickAttr = (id) => edit.editMode
      ? `onclick="app.toggleAttendancePerson('${id}')" style="cursor:pointer;"`
      : '';

    let html = '<div style="padding:16px 24px;">';

    if (edit.editMode) {
      html += '<div style="font-size:0.72rem; color:var(--gray-500); margin-bottom:12px; font-style:italic;">Tap any name to toggle present/absent.</div>';
    }

    html += `<div style="font-size:0.75rem; font-weight:700; color:var(--teal-dark); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Present (${present.length})</div>`;
    html += present.map(p => `
      <div ${clickAttr(p.id)} style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--gray-100); ${edit.editMode ? 'cursor:pointer;' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span style="font-size:0.85rem; font-weight:500; color:var(--slate);">${this.escapeHtml(p.firstName)} ${this.escapeHtml(p.lastName || '')}</span>
        <span style="font-size:0.72rem; color:var(--gray-500); margin-left:auto;">${this.capitalize(p.status)}</span>
      </div>
    `).join('');

    if (absent.length > 0) {
      html += `<div style="font-size:0.75rem; font-weight:700; color:var(--gray-500); text-transform:uppercase; letter-spacing:1px; margin:16px 0 8px;">Absent (${absent.length})</div>`;
      html += absent.map(p => `
        <div ${clickAttr(p.id)} style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--gray-100); opacity:${edit.editMode ? '0.75' : '0.5'}; ${edit.editMode ? 'cursor:pointer;' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span style="font-size:0.85rem; font-weight:500; color:var(--gray-600);">${this.escapeHtml(p.firstName)} ${this.escapeHtml(p.lastName || '')}</span>
        </div>
      `).join('');
    }

    html += '</div>';
    document.getElementById('attendanceDetailList').innerHTML = html;
  },

  toggleAttendanceEditMode() {
    if (!this.attendanceEdit) return;
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }
    this.attendanceEdit.editMode = true;
    this.renderAttendanceDetail();
  },

  cancelAttendanceEdit() {
    if (!this.attendanceEdit) return;
    // Restore from original record
    const record = this.data.attendance.find(a => a.date === this.attendanceEdit.date);
    if (record) {
      this.attendanceEdit.checkedIn = new Set(record.checkedIn);
    }
    this.attendanceEdit.editMode = false;
    this.renderAttendanceDetail();
  },

  toggleAttendancePerson(personId) {
    if (!this.attendanceEdit || !this.attendanceEdit.editMode) return;
    if (this.attendanceEdit.checkedIn.has(personId)) {
      this.attendanceEdit.checkedIn.delete(personId);
    } else {
      this.attendanceEdit.checkedIn.add(personId);
    }
    this.renderAttendanceDetail();
  },

  async saveAttendanceEdit() {
    if (!this.attendanceEdit) return;
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }

    const edit = this.attendanceEdit;
    const newCheckedIn = Array.from(edit.checkedIn);

    try {
      await db.upsertAttendance({
        date: edit.date,
        checkedIn: newCheckedIn,
        total: edit.total,
        newPeople: edit.newPeople || 0
      });

      // Update local cache
      const record = this.data.attendance.find(a => a.date === edit.date);
      if (record) record.checkedIn = newCheckedIn;

      // If editing today's record, sync kiosk checkinState
      const today = new Date().toISOString().split('T')[0];
      if (edit.date === today) {
        this.data.checkinState = {};
        newCheckedIn.forEach(id => { this.data.checkinState[id] = true; });
      }

      edit.editMode = false;
      this.renderAttendanceDetail();
      this.renderAll();
      this.toast('Attendance updated');
    } catch (err) {
      console.error('Failed to save attendance edit:', err);
      this.toast('Save failed — try again');
    }
  },

  async deleteAttendanceRecord() {
    if (!this.attendanceEdit) return;
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }

    const edit = this.attendanceEdit;
    const date = new Date(edit.date + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    if (!confirm(`Delete the entire check-in record for ${dateStr}?\n\nThis removes ${edit.checkedIn.size} check-ins permanently. This cannot be undone.`)) return;

    try {
      await db.deleteAttendance(edit.date);

      // Remove from local cache
      this.data.attendance = this.data.attendance.filter(a => a.date !== edit.date);

      // If deleting today's record, clear kiosk checkinState
      const today = new Date().toISOString().split('T')[0];
      if (edit.date === today) {
        this.data.checkinState = {};
      }

      this.attendanceEdit = null;
      this.closeModal('attendanceModal');
      this.renderAll();
      this.toast('Record deleted');
    } catch (err) {
      console.error('Failed to delete attendance:', err);
      this.toast('Delete failed — try again');
    }
  },

  // ---- PAST CHECK-IN ----
  pastCheckinState: {},

  openPastCheckinModal() {
    this.pastCheckinState = {};
    this._scanImages = [];
    document.getElementById('pastCheckinDate').value = '';
    document.getElementById('pastCheckinSearch').value = '';
    // Reset scan zone
    const scanZone = document.getElementById('scanZone');
    if (scanZone) scanZone.style.display = 'none';
    const scanPreviews = document.getElementById('scanPreviews');
    if (scanPreviews) scanPreviews.innerHTML = '';
    const extractBtn = document.getElementById('extractBtn');
    if (extractBtn) extractBtn.style.display = 'none';
    const scanStatus = document.getElementById('scanStatus');
    if (scanStatus) scanStatus.textContent = '';
    this.renderPastCheckinList();
    document.getElementById('pastCheckinModal').classList.add('show');
  },

  // ---- SCAN PAPER SHEET ----
  _scanImages: [],

  toggleScanZone() {
    const zone = document.getElementById('scanZone');
    if (!zone) return;
    const isOpen = zone.style.display !== 'none';
    zone.style.display = isOpen ? 'none' : '';
    document.getElementById('scanToggleBtn').style.background = isOpen ? '' : 'rgba(42,171,179,0.1)';
  },

  addScanImages(files) {
    if (!files || files.length === 0) return;
    const previews = document.getElementById('scanPreviews');
    const extractBtn = document.getElementById('extractBtn');

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const base64 = dataUrl.split(',')[1];
        const mimeType = file.type || 'image/jpeg';
        const idx = this._scanImages.length;
        this._scanImages.push({ data: base64, type: mimeType });

        // Thumbnail
        const thumb = document.createElement('div');
        thumb.className = 'scan-thumb';
        thumb.innerHTML = `
          <img src="${dataUrl}" alt="scan ${idx + 1}">
          <button class="scan-thumb-remove" onclick="app.removeScanImage(${idx}, this.parentNode)" title="Remove">&times;</button>
        `;
        previews.appendChild(thumb);

        if (extractBtn) extractBtn.style.display = '';
      };
      reader.readAsDataURL(file);
    });
  },

  removeScanImage(idx, thumbEl) {
    this._scanImages[idx] = null; // mark removed (keep array indices stable)
    thumbEl.remove();
    const remaining = this._scanImages.filter(Boolean).length;
    if (remaining === 0) {
      const extractBtn = document.getElementById('extractBtn');
      if (extractBtn) extractBtn.style.display = 'none';
    }
  },

  async extractNamesFromScan() {
    const apiKey = this._getClaudeKey();
    if (!apiKey) return;

    const images = this._scanImages.filter(Boolean);
    if (images.length === 0) { this.toast('Add at least one image first'); return; }

    const btn = document.getElementById('extractBtn');
    const statusEl = document.getElementById('scanStatus');
    btn.textContent = 'Extracting...';
    btn.disabled = true;
    statusEl.innerHTML = '<em>Reading names from image(s)...</em>';

    try {
      const content = [
        ...images.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.type, data: img.data }
        })),
        {
          type: 'text',
          text: 'These are photos of paper attendance sheets from a church gathering. Extract every person name you can see written down. Return ONLY a valid JSON array of strings with no extra explanation. Example: ["John Smith", "Sarah Jones", "Mike"]'
        }
      ];

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content }]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 401) {
          localStorage.removeItem('stpete_claude_key');
          throw new Error('Invalid API key — cleared. Try again.');
        }
        throw new Error(errText);
      }

      const data = await res.json();
      const rawText = data.content?.[0]?.text || '[]';

      // Parse JSON array from response
      let names = [];
      try {
        const match = rawText.match(/\[[\s\S]*?\]/);
        names = match ? JSON.parse(match[0]) : [];
      } catch {
        // Fallback: treat each line as a name
        names = rawText.split('\n')
          .map(l => l.replace(/^[-*•·\d.)\s]+/, '').trim())
          .filter(l => l.length > 1);
      }

      if (names.length === 0) {
        statusEl.textContent = 'No names found — try a clearer photo.';
        return;
      }

      const { matched, unmatched } = this._matchNamesToDatabase(names);
      matched.forEach(id => { this.pastCheckinState[id] = true; });
      this.renderPastCheckinList();

      statusEl.innerHTML =
        `<span style="color:var(--teal-dark); font-weight:700;">${matched.length} matched</span> of ${names.length} names found.` +
        (unmatched.length > 0
          ? `<br><span style="color:var(--gray-500); font-size:0.78rem;">Not matched: ${unmatched.map(n => `"${n}"`).join(', ')}</span>`
          : '');

      this.toast(`Auto-selected ${matched.length} people from scan`);

    } catch (err) {
      console.error('Scan error:', err);
      statusEl.innerHTML = `<span style="color:#DC2626;">${err.message || 'Scan failed — check API key'}</span>`;
    } finally {
      btn.textContent = 'Extract Names';
      btn.disabled = false;
    }
  },

  _matchNamesToDatabase(names) {
    const matched = [];
    const unmatched = [];
    const usedIds = new Set();

    names.forEach(rawName => {
      const norm = rawName.toLowerCase().trim().replace(/[^a-z\s]/g, '');
      const parts = norm.split(/\s+/).filter(Boolean);
      if (parts.length === 0) return;

      const firstName = parts[0];
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

      let found = null;

      // 1. Full name exact match
      found = this.data.people.find(p =>
        !usedIds.has(p.id) &&
        `${p.firstName} ${p.lastName}`.toLowerCase() === norm
      );

      // 2. First + last initial
      if (!found && lastName.length > 0) {
        found = this.data.people.find(p =>
          !usedIds.has(p.id) &&
          p.firstName.toLowerCase() === firstName &&
          (p.lastName || '').toLowerCase().startsWith(lastName[0])
        );
      }

      // 3. First name only (unambiguous)
      if (!found) {
        const candidates = this.data.people.filter(p =>
          !usedIds.has(p.id) && p.firstName.toLowerCase() === firstName
        );
        if (candidates.length === 1) found = candidates[0];
      }

      // 4. Last name only (unambiguous)
      if (!found && lastName.length > 1) {
        const candidates = this.data.people.filter(p =>
          !usedIds.has(p.id) && (p.lastName || '').toLowerCase() === lastName
        );
        if (candidates.length === 1) found = candidates[0];
      }

      // 5. Substring match on full name
      if (!found) {
        found = this.data.people.find(p => {
          if (usedIds.has(p.id)) return false;
          const full = `${p.firstName} ${p.lastName}`.toLowerCase();
          return full.includes(norm) || norm.includes(p.firstName.toLowerCase());
        });
      }

      if (found) {
        usedIds.add(found.id);
        matched.push(found.id);
      } else {
        unmatched.push(rawName);
      }
    });

    return { matched, unmatched };
  },

  _getClaudeKey() {
    let key = localStorage.getItem('stpete_claude_key');
    if (!key) {
      key = prompt(
        'Enter your Anthropic API key to use image scanning.\n' +
        'It will be saved in your browser for future use.\n\n' +
        '(Get one at console.anthropic.com)'
      );
      if (!key) return null;
      localStorage.setItem('stpete_claude_key', key.trim());
    }
    return key;
  },

  renderPastCheckinList() {
    const list = document.getElementById('pastCheckinList');
    if (!list) return;

    const search = (document.getElementById('pastCheckinSearch')?.value || '').toLowerCase();
    let people = [...this.data.people].sort((a, b) => a.firstName.localeCompare(b.firstName));

    if (search) {
      people = people.filter(p => `${p.firstName} ${p.lastName}`.toLowerCase().includes(search));
    }

    list.innerHTML = people.map(p => {
      const isChecked = this.pastCheckinState[p.id] || false;
      return `
        <div class="checkin-row ${isChecked ? 'checked' : ''}" onclick="app.togglePastCheckin('${p.id}')">
          <div class="checkin-checkbox">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="checkin-info">
            <span class="checkin-name">${p.firstName} ${p.lastName || ''}</span>
            <span class="checkin-meta">${this.capitalize(p.status)}</span>
          </div>
        </div>
      `;
    }).join('');

    const count = Object.values(this.pastCheckinState).filter(Boolean).length;
    const countEl = document.getElementById('pastCheckinCount');
    if (countEl) countEl.textContent = `${count} people selected`;
  },

  togglePastCheckin(id) {
    this.pastCheckinState[id] = !this.pastCheckinState[id];
    this.renderPastCheckinList();
  },

  async savePastCheckin() {
    const date = document.getElementById('pastCheckinDate').value;
    if (!date) { this.toast('Please select a date'); return; }

    const checkedIds = Object.entries(this.pastCheckinState)
      .filter(([, v]) => v)
      .map(([id]) => id);

    if (checkedIds.length === 0) { this.toast('No one selected'); return; }

    const newCount = this.data.people.filter(p =>
      checkedIds.includes(p.id) && p.status === 'new'
    ).length;

    await db.upsertAttendance({
      date,
      checkedIn: checkedIds,
      total: this.data.people.length,
      newPeople: newCount
    });

    this.closeModal('pastCheckinModal');
    await this.refresh();
    this.toast(`Saved! ${checkedIds.length} people checked in for ${date}`);
  },

  // ---- QUICK ADD (CHECK-IN PAGE) ----
  async quickAddPerson() {
    const firstName = document.getElementById('quickFirst').value.trim();
    if (!firstName) { this.toast('First name is required'); return; }

    const newPerson = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      firstName,
      lastName: document.getElementById('quickLast').value.trim(),
      phone: document.getElementById('quickPhone').value.trim(),
      email: '',
      status: 'new',
      stage: 'attending',
      connector: document.getElementById('quickConnector').value.trim(),
      notes: 'Added during Thursday check-in',
      lastAttended: new Date().toISOString().split('T')[0],
      needsFollowup: true,
      followupDone: false,
      attendanceCount: 1
    };

    await db.upsertPerson(newPerson);
    this.data.checkinState[newPerson.id] = true;

    document.getElementById('quickFirst').value = '';
    document.getElementById('quickLast').value = '';
    document.getElementById('quickPhone').value = '';
    document.getElementById('quickConnector').value = '';

    await this.refresh();
    this.toast(`${firstName} added & checked in!`);
  },

  // ---- CSV IMPORT ----
  csvParsedData: [],

  setupCSVDrop() {
    const zone = document.getElementById('csvDropZone');
    if (!zone) return;

    zone.addEventListener('click', () => {
      document.getElementById('csvFileInput').click();
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) this.handleCSVFile(file);
    });
  },

  handleCSVFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      this.parseCSV(text);
    };
    reader.readAsText(file);
  },

  parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { this.toast('CSV appears empty'); return; }

    // Parse header
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = this.splitCSVLine(lines[0], delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

    // Column mapping
    const map = {};
    const firstNameAliases = ['first name', 'first_name', 'firstname', 'first', 'name', 'fname'];
    const lastNameAliases = ['last name', 'last_name', 'lastname', 'last', 'lname', 'surname'];
    const phoneAliases = ['phone', 'mobile', 'cell', 'number', 'phone number', 'phone_number'];
    const emailAliases = ['email', 'e-mail', 'email address', 'email_address'];
    const statusAliases = ['status', 'type', 'category'];
    const connectorAliases = ['connected to', 'connected_to', 'connector', 'invited by', 'invited_by', 'brought by'];
    const notesAliases = ['notes', 'note', 'comments', 'comment'];

    headers.forEach((h, i) => {
      if (firstNameAliases.includes(h)) map.firstName = i;
      else if (lastNameAliases.includes(h)) map.lastName = i;
      else if (phoneAliases.includes(h)) map.phone = i;
      else if (emailAliases.includes(h)) map.email = i;
      else if (statusAliases.includes(h)) map.status = i;
      else if (connectorAliases.includes(h)) map.connector = i;
      else if (notesAliases.includes(h)) map.notes = i;
    });

    // If no first name column found, try "name" as full name
    if (map.firstName === undefined) {
      const nameIdx = headers.findIndex(h => h === 'name' || h === 'full name' || h === 'fullname');
      if (nameIdx >= 0) map.fullName = nameIdx;
      else { map.firstName = 0; } // Fallback: first column is first name
    }

    // Parse rows
    this.csvParsedData = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCSVLine(lines[i], delimiter);
      if (cols.length === 0 || !cols.join('').trim()) continue;

      let firstName, lastName;
      if (map.fullName !== undefined) {
        const parts = (cols[map.fullName] || '').trim().replace(/['"]/g, '').split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ');
      } else {
        firstName = (cols[map.firstName] || '').trim().replace(/['"]/g, '');
        lastName = map.lastName !== undefined ? (cols[map.lastName] || '').trim().replace(/['"]/g, '') : '';
      }

      if (!firstName) continue;

      const validStatuses = ['new', 'returning', 'consistent', 'core', 'leader'];
      let status = map.status !== undefined ? (cols[map.status] || '').trim().toLowerCase().replace(/['"]/g, '') : 'new';
      if (!validStatuses.includes(status)) status = 'new';

      this.csvParsedData.push({
        firstName,
        lastName,
        phone: map.phone !== undefined ? (cols[map.phone] || '').trim().replace(/['"]/g, '') : '',
        email: map.email !== undefined ? (cols[map.email] || '').trim().replace(/['"]/g, '') : '',
        status,
        connector: map.connector !== undefined ? (cols[map.connector] || '').trim().replace(/['"]/g, '') : '',
        notes: map.notes !== undefined ? (cols[map.notes] || '').trim().replace(/['"]/g, '') : ''
      });
    }

    if (this.csvParsedData.length === 0) {
      this.toast('No valid rows found in CSV');
      return;
    }

    // Show preview
    this.showCSVPreview();
  },

  splitCSVLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current);
    return result;
  },

  showCSVPreview() {
    document.getElementById('csvPreviewCount').textContent = `${this.csvParsedData.length} people found`;
    const table = document.getElementById('csvPreviewTable');

    table.innerHTML = `
      <table>
        <thead>
          <tr><th>First</th><th>Last</th><th>Phone</th><th>Email</th><th>Status</th><th>Connected To</th></tr>
        </thead>
        <tbody>
          ${this.csvParsedData.slice(0, 50).map(p => `
            <tr>
              <td>${p.firstName}</td>
              <td>${p.lastName}</td>
              <td>${p.phone}</td>
              <td>${p.email}</td>
              <td>${p.status}</td>
              <td>${p.connector}</td>
            </tr>
          `).join('')}
          ${this.csvParsedData.length > 50 ? '<tr><td colspan="6" style="text-align:center; color:var(--gray-400);">...and ' + (this.csvParsedData.length - 50) + ' more</td></tr>' : ''}
        </tbody>
      </table>
    `;

    document.getElementById('csvPreview').style.display = 'block';
    document.getElementById('csvDropZone').style.display = 'none';
  },

  cancelCSV() {
    this.csvParsedData = [];
    document.getElementById('csvPreview').style.display = 'none';
    document.getElementById('csvDropZone').style.display = '';
    document.getElementById('csvFileInput').value = '';
  },

  async confirmCSVImport() {
    let skipped = 0;
    const toInsert = [];

    this.csvParsedData.forEach((p, i) => {
      const exists = this.data.people.find(existing =>
        existing.firstName.toLowerCase() === p.firstName.toLowerCase() &&
        (existing.lastName || '').toLowerCase() === (p.lastName || '').toLowerCase()
      );

      if (exists) { skipped++; return; }

      toInsert.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5) + i,
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        email: p.email,
        status: p.status,
        stage: 'attending',
        connector: p.connector,
        notes: p.notes,
        needsFollowup: p.status === 'new',
        attendanceCount: 0
      });
    });

    if (toInsert.length > 0) {
      await db.bulkInsertPeople(toInsert);
    }

    this.cancelCSV();
    document.getElementById('csvUploadArea').classList.remove('show');
    await this.refresh();
    this.toast(`Imported ${toInsert.length} people${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`);
  },

  // ---- PRIORITY GOALS (Timeline) ----
  _priorityDefaults: {
    goals: [
      'Grow consistent attendance to 40+ people',
      'Identify and develop 3 table leaders by June',
      'Launch first microgroup (men\'s or women\'s)',
      'Every new person followed up within 24 hours'
    ],
    steps: [
      'Meet 1-on-1 with a potential leader this week',
      'Assign someone to own Thursday food/hospitality',
      'Follow up with anyone who missed last two weeks',
      'Plan next month\'s teaching series'
    ]
  },

  renderPriorityGoals() {
    const goalsEl = document.getElementById('priorityGoalsList');
    const stepsEl = document.getElementById('nextStepsList');
    if (!goalsEl || !stepsEl) return;

    const saved = JSON.parse(localStorage.getItem('stpete_priorities') || 'null') || this._priorityDefaults;

    goalsEl.innerHTML = saved.goals.map((g, i) => `
      <div class="priority-item">
        <span class="priority-num">${i + 1}</span>
        <span>${g}</span>
      </div>
    `).join('');

    stepsEl.innerHTML = saved.steps.map((s, i) => `
      <div class="priority-item">
        <span class="priority-step-dot"></span>
        <span>${s}</span>
      </div>
    `).join('');
  },

  _editingPriorityKey: null,

  editPriorityGoals() {
    this._editingPriorityKey = 'goals';
    const saved = JSON.parse(localStorage.getItem('stpete_priorities') || 'null') || this._priorityDefaults;
    document.getElementById('priorityModalTitle').textContent = 'Edit High Priority Goals';
    document.getElementById('priorityModalText').value = saved.goals.join('\n');
    document.getElementById('priorityModal').classList.add('show');
  },

  editNextSteps() {
    this._editingPriorityKey = 'steps';
    const saved = JSON.parse(localStorage.getItem('stpete_priorities') || 'null') || this._priorityDefaults;
    document.getElementById('priorityModalTitle').textContent = 'Edit Next Steps';
    document.getElementById('priorityModalText').value = saved.steps.join('\n');
    document.getElementById('priorityModal').classList.add('show');
  },

  savePriorityEdit() {
    const text = document.getElementById('priorityModalText').value;
    const items = text.split('\n').map(l => l.trim()).filter(Boolean);
    const saved = JSON.parse(localStorage.getItem('stpete_priorities') || 'null') || this._priorityDefaults;
    saved[this._editingPriorityKey] = items;
    localStorage.setItem('stpete_priorities', JSON.stringify(saved));
    this.closeModal('priorityModal');
    this.renderPriorityGoals();
    this.toast('Saved!');
  },

  // ---- ATTENDANCE REPORT ----
  renderAttendanceReport() {
    const container = document.getElementById('attendanceReport');
    const card = document.getElementById('attendanceReportCard');
    if (!container || !card) return;

    // Need at least 3 meetings worth of data
    const meetings = [...this.data.attendance].sort((a, b) => b.date.localeCompare(a.date));
    if (meetings.length < 3) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';

    // For each person, count how many of the last 6 meetings they missed (consecutively from most recent)
    const recentMeetings = meetings.slice(0, 6);

    const missedOne = [];
    const missedTwo = [];
    const missedThree = [];

    this.data.people.forEach(p => {
      // Count consecutive misses from most recent
      let consecutive = 0;
      for (const m of recentMeetings) {
        if (!m.checkedIn.includes(p.id)) {
          consecutive++;
        } else {
          break;
        }
      }

      if (consecutive === 0 || consecutive > 3) return; // Attended recently OR missed so many they're inactive

      const entry = { id: p.id, name: `${p.firstName} ${p.lastName || ''}`, consecutive };
      if (consecutive >= 3) missedThree.push(entry);
      else if (consecutive >= 2) missedTwo.push(entry);
      else missedOne.push(entry);
    });

    if (missedOne.length === 0 && missedTwo.length === 0 && missedThree.length === 0) {
      container.innerHTML = '<p class="empty-state">Great attendance! No one missed more than one meeting in a row.</p>';
      return;
    }

    const renderGroup = (title, color, list) => {
      if (list.length === 0) return '';
      return `
        <div class="report-group">
          <div class="report-group-header" style="color:${color};">${title} <span class="report-count">${list.length}</span></div>
          ${list.map(p => `
            <div class="report-row">
              <span class="report-name">${p.name}</span>
              <label class="report-reached-label">
                <input type="checkbox" onchange="app.markReportReachedOut('${p.id}', this.checked)" ${this._reachedOut[p.id] ? 'checked' : ''}>
                Reached out
              </label>
            </div>
          `).join('')}
        </div>
      `;
    };

    container.innerHTML =
      renderGroup('Missed Last 3 Meetings', 'var(--pink)', missedThree) +
      renderGroup('Missed Last 2 Meetings', 'var(--gold)', missedTwo) +
      renderGroup('Missed This Week', 'var(--gray-600)', missedOne);
  },

  _reachedOut: {},

  markReportReachedOut(id, checked) {
    this._reachedOut[id] = checked;
    // Persist in localStorage for this session
    localStorage.setItem('stpete_reached_out', JSON.stringify(this._reachedOut));
  },

  // ---- PIPELINE: REMOVE INACTIVE ----
  async removeInactivePipeline() {
    const meetings = [...this.data.attendance].sort((a, b) => b.date.localeCompare(a.date));
    if (meetings.length < 4) {
      this.toast('Need at least 4 meeting records to check inactivity');
      return;
    }

    const recentFour = meetings.slice(0, 4);
    const toRemove = this.data.people.filter(p => {
      // Missed all of the last 4 meetings
      return recentFour.every(m => !m.checkedIn.includes(p.id));
    });

    if (toRemove.length === 0) {
      this.toast('No one has missed 4+ meetings in a row');
      return;
    }

    const names = toRemove.map(p => `${p.firstName} ${p.lastName || ''}`).join(', ');
    if (!confirm(`Remove from pipeline (${toRemove.length} people who missed last 4+ meetings)?\n\n${names}\n\nNote: This removes them from the pipeline stage only — they stay in your people list.`)) return;

    await Promise.all(toRemove.map(p => db.updatePerson(p.id, { stage: 'attending' })));
    await this.refresh();
    this.toast(`Moved ${toRemove.length} inactive people back to Attending`);
  },

  // ---- MODALS ----
  closeModal(id) {
    document.getElementById(id).classList.remove('show');
    if (id === 'attendanceModal') this.attendanceEdit = null;
    if (id === 'weekDetailModal') this.weekDetailContext = null;
  },

  // ---- TOAST ----
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  },

  // ---- UTILS ----
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // ==================== GAME PLAN ====================
  getGamePlanDefault() {
    return {
      structures: [
        {
          week: 'WEEK 1', type: 'community', name: 'COMMUNITY NIGHT',
          times: [
            { label: '6:30', desc: 'Arrival + light food' },
            { label: '6:45', desc: 'Welcome + icebreaker' },
            { label: '7:00', desc: 'Bible study (core teaching)' },
            { label: '7:45', desc: 'Prayer + hangout' }
          ],
          goal: 'Anchors the 50-60s. Strong teaching, warm room, no pressure.',
          details: {
            music: 'Soft worship / hymns — comfort for the 50-60s',
            energy: 'Reflective, thoughtful pace. Set the tone in the first 5 minutes.',
            conversation: 'Family updates, health, work transitions — lean into the older crowd\'s life',
            seating: 'Mixed ages intentionally. Put connectors at each table. Rotate weekly.'
          }
        },
        {
          week: 'WEEK 2', type: 'growth', name: 'GROWTH NIGHT',
          times: [
            { label: '6:30', desc: 'Arrival + food' },
            { label: '6:45', desc: 'Opening win / celebration' },
            { label: '7:00', desc: 'Problem-solve together (campus topic)' },
            { label: '7:45', desc: 'Commit to next steps' }
          ],
          goal: 'Gives the 30s ownership. We build the campus together.',
          details: {
            music: 'Upbeat contemporary — 30s energy',
            energy: 'Solution-focused, action-oriented. Open with the problem to solve.',
            conversation: 'Career moves, weekend plans, life goals — 30s interests lead',
            seating: 'Mix ages, but weight toward the 30s voice carrying the room. Rotate weekly.'
          }
        },
        {
          week: 'WEEK 3', type: 'groups', name: 'GROUPS NIGHT',
          times: [
            { label: '6:30', desc: 'Arrival + food' },
            { label: '6:45', desc: 'Quick group welcome' },
            { label: '7:00', desc: 'Split by life stage / interest' },
            { label: '7:50', desc: 'Regather + prayer' }
          ],
          goal: 'Practice the microgroup format. Build future group leaders.',
          details: {
            music: 'Acoustic / coffeehouse vibe — low volume, conversational',
            energy: 'Intimate, conversational. The room should feel like a living room.',
            conversation: 'Inside each group — "Best thing that happened this week?" opens everyone up',
            seating: 'Split intentionally by life stage or interest. This is where future microgroups form.'
          }
        },
        {
          week: 'WEEK 4', type: 'invite', name: 'INVITE / FUN NIGHT',
          times: [
            { label: '6:30', desc: 'Arrival + food' },
            { label: '6:45', desc: 'Activity / game / theme' },
            { label: '7:30', desc: 'Short gospel moment' },
            { label: '7:45', desc: 'Hangout' }
          ],
          goal: 'Low-pressure door. Everyone brings one person. Grow by invitation.',
          details: {
            music: 'Popular / secular music guests will recognize — meets them where they are',
            energy: 'High energy, celebratory. Keep it fun and moving.',
            conversation: '"Best thing that happened this week?" — universal opener anyone can answer',
            seating: 'Mix ages heavily. Connectors host every table. Never seat guests alone.'
          }
        },
        {
          week: '5TH WEEK', type: 'serve', name: 'SERVE PROJECT',
          times: [
            { label: 'Varies', desc: 'Off-site community service' },
            { label: '', desc: 'Partner with a local org when possible' },
            { label: '', desc: 'Photos + story for social after' }
          ],
          goal: 'Be known in St. Pete. Love the city before we launch to it.',
          details: {
            music: 'None or upbeat in transit — focus is on the work, not the stage',
            energy: 'Servant-hearted, hands-on. Lead by serving alongside, not from out front.',
            conversation: 'Stories from the day — what did you see, who did you meet?',
            seating: 'N/A — work side by side. Pair new people with veterans.'
          }
        }
      ],
      months: [
        { id: 'apr2026', name: 'April 2026', weeks: [
          { date: 'Apr 2', type: 'community', desc: '**Community Night** — Kick off the new rhythm. Set the vibe.' },
          { date: 'Apr 9', type: 'growth', desc: '**Growth Night** — What does a healthy St. Pete campus look like?' },
          { date: 'Apr 16', type: 'groups', desc: '**Groups Night** — Split by life stage. Test future microgroup chemistry.' },
          { date: 'Apr 23', type: 'invite', desc: '**GAME NIGHT** — Board games + pizza. Everyone brings one person.' },
          { date: 'Apr 30', type: 'serve', desc: '**Serve Project** — Neighborhood outreach day.' }
        ]},
        { id: 'may2026', name: 'May 2026', weeks: [
          { date: 'May 7', type: 'community', desc: '**Community Night** — Open the new teaching series.' },
          { date: 'May 14', type: 'growth', desc: '**Growth Night** — Who are the 10 leaders we need by August?' },
          { date: 'May 21', type: 'groups', desc: '**Groups Night** — Practice microgroup format. Demographic splits.' },
          { date: 'May 28', type: 'invite', desc: '**TRIVIA NIGHT** — Bible + pop culture trivia. Friend-bring competition.' }
        ]},
        { id: 'jun2026', name: 'June 2026', weeks: [
          { date: 'Jun 4', type: 'community', desc: '**Community Night** — Deeper in the series.' },
          { date: 'Jun 11', type: 'growth', desc: '**Growth Night** — Kids ministry plan. What do we need by launch?' },
          { date: 'Jun 18', type: 'groups', desc: '**Groups Night** — Pilot microgroups begin meeting off-Thursdays.' },
          { date: 'Jun 25', type: 'invite', desc: '**MOVIE NIGHT** — Outdoor movie. Invite 2+ people each.' }
        ]},
        { id: 'jul2026', name: 'July 2026', weeks: [
          { date: 'Jul 2', type: 'community', desc: '**Community Night** — Mid-summer momentum check.' },
          { date: 'Jul 9', type: 'growth', desc: '**Growth Night** — Volunteer team structure: greeters, kids, setup, worship.' },
          { date: 'Jul 16', type: 'groups', desc: '**Groups Night** — Groups report back. Refine model.' },
          { date: 'Jul 23', type: 'invite', desc: '**PIZZA & VISION NIGHT** — Cast vision for launch. Bring anyone curious.' },
          { date: 'Jul 30', type: 'serve', desc: '**Serve Project** — Big serve day with a local partner org.' }
        ]},
        { id: 'aug2026', name: 'August 2026', weeks: [
          { date: 'Aug 6', type: 'community', desc: '**Community Night** — Launch readiness teaching begins.' },
          { date: 'Aug 13', type: 'growth', desc: '**Growth Night** — Venue walkthrough + production plan.' },
          { date: 'Aug 20', type: 'groups', desc: '**Groups Night** — Covenant conversation with core team.' },
          { date: 'Aug 27', type: 'invite', desc: '**DESSERT & DREAMS NIGHT** — Share the St. Pete dream. Invite everyone.' }
        ]},
        { id: 'sep2026', name: 'September 2026', weeks: [
          { date: 'Sep 3', type: 'community', desc: '**Community Night** — Final push toward preview services.' },
          { date: 'Sep 10', type: 'growth', desc: '**Growth Night** — Volunteer team assignments finalized.' },
          { date: 'Sep 17', type: 'groups', desc: '**Groups Night** — Microgroups officially launched.' },
          { date: 'Sep 24', type: 'invite', desc: '**INVITE NIGHT** — Last big invite before preview services begin.' }
        ]}
      ]
    };
  },

  loadGamePlan() {
    const saved = localStorage.getItem('stpete_gameplan');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.structures && parsed.months) return parsed;
      } catch(e) { /* fall through */ }
    }
    return this.getGamePlanDefault();
  },

  persistGamePlan() {
    localStorage.setItem('stpete_gameplan', JSON.stringify(this.data.gameplan));
    // Debounced cloud save
    clearTimeout(this._gameplanCloudSaveTimer);
    this._gameplanCloudSaveTimer = setTimeout(() => this._cloudSaveGamePlan(), 1000);
  },

  async _cloudSaveGamePlan() {
    if (!this.hasMinRole('editor')) return;
    try {
      await db.saveGamePlan(this.data.gameplan, this.currentUser?.userId || null);
    } catch (err) {
      console.error('Cloud save of gameplan failed:', err);
    }
  },

  async syncGamePlanFromCloud() {
    try {
      const row = await db.getGamePlan();
      if (row && row.data && row.data.structures && row.data.months) {
        this.data.gameplan = row.data;
        this.data.gameplanMeta = {
          is_published: !!row.is_published,
          updated_by: row.updated_by,
          updated_at: row.updated_at
        };
        localStorage.setItem('stpete_gameplan', JSON.stringify(this.data.gameplan));
        this.renderGamePlan();
        this.updateGameplanPublishStatus();
        this.toast('Game plan pulled from cloud');
      } else {
        this.toast('No cloud game plan yet');
      }
    } catch (err) {
      this.toast('Pull failed');
    }
  },

  async publishGamePlan() {
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }
    // Force-save current state first
    try {
      await db.saveGamePlan(this.data.gameplan, this.currentUser?.userId || null);
      await db.publishGamePlan(true);
      if (!this.data.gameplanMeta) this.data.gameplanMeta = {};
      this.data.gameplanMeta.is_published = true;
      this.updateGameplanPublishStatus();
      this.toast('Published! Public page will show upcoming weeks.');
    } catch (err) {
      this.toast('Publish failed');
    }
  },

  updateGameplanPublishStatus() {
    const el = document.getElementById('gameplanPublishStatus');
    const btn = document.getElementById('gameplanPublishBtn');
    if (!el) return;
    const meta = this.data.gameplanMeta || {};
    if (meta.is_published) {
      const when = meta.updated_at
        ? new Date(meta.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      el.innerHTML = `✓ Published · last saved ${this.escapeHtml(when)}${meta.updated_by ? ' by <strong>' + this.escapeHtml(meta.updated_by) + '</strong>' : ''}`;
      if (btn) { btn.textContent = 'Re-publish'; btn.classList.add('published'); }
    } else {
      el.textContent = 'Not published yet — click to make it visible on the public page.';
      if (btn) { btn.textContent = 'Publish to Public Page'; btn.classList.remove('published'); }
    }
  },

  // ============================================
  //                 RETENTION
  // ============================================

  // Compute the canonical list of Thursday attendance records, sorted oldest -> newest.
  _retentionTimeline() {
    return [...(this.data.attendance || [])]
      .filter(a => a && a.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  // "Tonight" is the most recent Thursday record, OR today if we're mid-check-in.
  // Fall back to the latest record if today isn't present.
  _retentionTonightRecord() {
    const today = new Date().toISOString().split('T')[0];
    const timeline = this._retentionTimeline();
    const todayRec = timeline.find(a => a.date === today);
    return todayRec || timeline[timeline.length - 1] || null;
  },

  // Build a map of personId -> attended date strings (sorted asc)
  _retentionPersonHistory() {
    const map = new Map();
    const timeline = this._retentionTimeline();
    timeline.forEach(rec => {
      (rec.checkedIn || []).forEach(pid => {
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid).push(rec.date);
      });
    });
    return map;
  },

  // ---- Missing Tonight ----
  // People who came in 1 of the last 3 weeks (excluding tonight) but aren't here tonight yet.
  // Priority scored by recency + frequency so the list is naturally ranked.
  getMissingTonightList() {
    const timeline = this._retentionTimeline();
    if (timeline.length < 2) return [];

    const tonight = this._retentionTonightRecord();
    if (!tonight) return [];
    const tonightIds = new Set(tonight.checkedIn || []);

    // Look at the 3 Thursdays BEFORE tonight
    const recent = timeline
      .filter(r => r.date !== tonight.date)
      .slice(-3);

    const history = this._retentionPersonHistory();
    const results = [];

    this.data.people.forEach(p => {
      if (tonightIds.has(p.id)) return; // Already here — not missing
      if (['inactive', 'dropped'].includes(p.status)) return;

      const attendedRecent = recent.filter(r => (r.checkedIn || []).includes(p.id));
      if (attendedRecent.length === 0) return; // Haven't been around recently

      const hist = history.get(p.id) || [];
      const lastAttended = hist[hist.length - 1] || '';
      // Priority: more recent weeks attended + higher count = higher score
      const recencyBoost = attendedRecent[attendedRecent.length - 1] === recent[recent.length - 1]?.date ? 2 : 0;
      const score = attendedRecent.length * 10 + recencyBoost;

      results.push({
        id: p.id,
        name: `${p.firstName} ${p.lastName || ''}`.trim(),
        firstName: p.firstName,
        phone: p.phone || '',
        attendedWeeks: attendedRecent.length,
        lastAttended,
        score,
        urgent: attendedRecent.length >= 2 // Came 2+ of last 3 weeks = high value
      });
    });

    return results.sort((a, b) => b.score - a.score);
  },

  // ---- Ghosted Guests ----
  // Came 2+ weeks in a row, then missed the last 2+ Thursdays. They liked it — go get them.
  getGhostedGuests() {
    const timeline = this._retentionTimeline();
    if (timeline.length < 4) return [];

    const history = this._retentionPersonHistory();
    const results = [];
    const recent5 = timeline.slice(-5); // Window we analyze
    const lastTwo = recent5.slice(-2).map(r => r.date);

    this.data.people.forEach(p => {
      if (['inactive', 'dropped'].includes(p.status)) return;
      const hist = history.get(p.id) || [];
      if (hist.length < 2) return;

      // Must have missed BOTH of the last two Thursdays in the window
      const missedLastTwo = lastTwo.every(d => !hist.includes(d));
      if (!missedLastTwo) return;

      // Must have at least one "run" of 2+ consecutive attended Thursdays somewhere in recent weeks
      let maxRun = 0;
      let run = 0;
      recent5.forEach(rec => {
        if (hist.includes(rec.date)) {
          run++;
          if (run > maxRun) maxRun = run;
        } else {
          run = 0;
        }
      });
      if (maxRun < 2) return;

      const lastAttended = hist[hist.length - 1] || '';
      const daysGone = lastAttended
        ? Math.max(0, Math.round((Date.now() - new Date(lastAttended).getTime()) / 86400000))
        : 999;

      results.push({
        id: p.id,
        name: `${p.firstName} ${p.lastName || ''}`.trim(),
        firstName: p.firstName,
        phone: p.phone || '',
        streak: maxRun,
        lastAttended,
        daysGone
      });
    });

    return results.sort((a, b) => b.streak - a.streak || a.daysGone - b.daysGone);
  },

  // ---- Render ----
  renderRetention() {
    const timeline = this._retentionTimeline();

    // Summary metrics
    const lastRec = timeline[timeline.length - 1];
    const lastWeekEl = document.getElementById('retLastWeek');
    const lastWeekDateEl = document.getElementById('retLastWeekDate');
    if (lastWeekEl && lastWeekDateEl) {
      if (lastRec) {
        const count = (lastRec.checkedIn || []).length;
        lastWeekEl.textContent = count;
        lastWeekDateEl.textContent = this._formatRetentionDate(lastRec.date);
      } else {
        lastWeekEl.textContent = '—';
        lastWeekDateEl.textContent = 'No data yet';
      }
    }

    // 4-week average + trend vs previous 4
    const last4 = timeline.slice(-4);
    const prev4 = timeline.slice(-8, -4);
    const avg = arr => arr.length ? Math.round(arr.reduce((sum, r) => sum + (r.checkedIn || []).length, 0) / arr.length) : 0;
    const avg4 = avg(last4);
    const prevAvg = avg(prev4);
    const avgEl = document.getElementById('retAvg4');
    const trendEl = document.getElementById('retAvgTrend');
    if (avgEl) avgEl.textContent = last4.length ? avg4 : '—';
    if (trendEl) {
      if (prev4.length && last4.length) {
        const diff = avg4 - prevAvg;
        if (diff > 0) trendEl.innerHTML = `<span style="color:#1B7A80;font-weight:700;">▲ +${diff}</span> vs previous 4`;
        else if (diff < 0) trendEl.innerHTML = `<span style="color:#c4486a;font-weight:700;">▼ ${diff}</span> vs previous 4`;
        else trendEl.textContent = 'Flat vs previous 4';
      } else {
        trendEl.textContent = 'Need 8 weeks of data';
      }
    }

    // Lists
    const missing = this.getMissingTonightList();
    const ghosted = this.getGhostedGuests();

    const missingEl = document.getElementById('retMissingCount');
    if (missingEl) missingEl.textContent = missing.length;
    const ghostedEl = document.getElementById('retGhostedCount');
    if (ghostedEl) ghostedEl.textContent = ghosted.length;

    // Nav badge = urgent retention count (missing 2+ weeks + ghosted)
    const urgent = missing.filter(m => m.urgent).length + ghosted.length;
    const badge = document.getElementById('retentionBadge');
    if (badge) {
      badge.textContent = urgent;
      badge.style.display = urgent > 0 ? '' : 'none';
    }

    this._renderRetentionList('missingTonightList', missing, 'missing');
    this._renderRetentionList('ghostedList', ghosted, 'ghosted');

    // The canvas has zero clientWidth while the page is hidden, so defer the draw
    // until the page is actually visible. Also redraw on window resize.
    const page = document.getElementById('page-retention');
    const canvas = document.getElementById('attendanceChart');
    if (page && canvas) {
      if (page.classList.contains('active')) {
        this._drawAttendanceChart(timeline);
      } else {
        // Stash the timeline so we can render on demand when navigate() flips the page active
        this._pendingRetentionTimeline = timeline;
      }
      if (!this._retentionResizeBound) {
        this._retentionResizeBound = true;
        window.addEventListener('resize', () => {
          if (document.getElementById('page-retention')?.classList.contains('active')) {
            this._drawAttendanceChart(this._retentionTimeline());
          }
        });
      }
    }
  },

  _renderRetentionList(containerId, rows, variant) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (rows.length === 0) {
      container.innerHTML = variant === 'missing'
        ? '<p class="empty-state">No one to reach out to tonight — either everyone\'s here or there\'s no attendance history yet.</p>'
        : '<p class="empty-state">Nobody has ghosted. Great retention!</p>';
      return;
    }

    container.innerHTML = rows.map(r => {
      const initials = ((r.name || '').match(/\b[A-Z]/g) || []).slice(0, 2).join('').toUpperCase() || 'SP';
      let meta, badge;
      if (variant === 'missing') {
        meta = `Came ${r.attendedWeeks} of last 3 · Last: ${this._formatRetentionDate(r.lastAttended)}`;
        badge = r.urgent
          ? '<span class="retention-row-badge urgent">High Priority</span>'
          : '<span class="retention-row-badge">Recent</span>';
      } else {
        meta = `${r.streak}-week streak · Last here ${r.daysGone}d ago`;
        badge = '<span class="retention-row-badge urgent">Ghosted</span>';
      }

      const canText = r.phone && r.phone.length >= 7;
      const textBtn = canText
        ? `<button class="retention-action-btn primary" onclick="app.openRetentionText('${r.id}', '${variant}')">Text</button>`
        : `<button class="retention-action-btn ghost" disabled title="No phone number">No phone</button>`;
      const followBtn = `<button class="retention-action-btn ghost" onclick="app.flagForFollowup('${r.id}')">Flag</button>`;

      return `
        <div class="retention-row ${variant === 'ghosted' || (variant === 'missing' && r.urgent) ? 'is-urgent' : ''}">
          <div class="retention-row-avatar">${initials}</div>
          <div class="retention-row-info">
            <div class="retention-row-name">${this.escapeHtml(r.name)}</div>
            <div class="retention-row-meta">${this.escapeHtml(meta)}</div>
          </div>
          ${badge}
          <div class="retention-row-actions">
            ${textBtn}
            ${followBtn}
          </div>
        </div>
      `;
    }).join('');
  },

  _formatRetentionDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) { return iso; }
  },

  // ---- Canvas line chart (no external library) ----
  _drawAttendanceChart(timeline) {
    const canvas = document.getElementById('attendanceChart');
    const emptyEl = document.getElementById('attendanceChartEmpty');
    if (!canvas) return;

    if (!timeline || timeline.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      canvas.style.visibility = 'hidden';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    canvas.style.visibility = 'visible';

    // Use last 12 weeks max
    const data = timeline.slice(-12).map(r => ({
      date: r.date,
      total: (r.checkedIn || []).length,
      newPeople: r.newPeople || 0
    }));

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const cssHeight = 260;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const pad = { top: 20, right: 20, bottom: 44, left: 40 };
    const w = cssWidth - pad.left - pad.right;
    const h = cssHeight - pad.top - pad.bottom;

    const maxVal = Math.max(5, ...data.map(d => d.total));
    const niceMax = Math.ceil(maxVal / 5) * 5;

    // Y-axis grid
    ctx.strokeStyle = 'rgba(142, 153, 164, 0.18)';
    ctx.lineWidth = 1;
    ctx.font = '11px Karla, -apple-system, sans-serif';
    ctx.fillStyle = '#8E99A4';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = pad.top + (h * i) / steps;
      const val = Math.round(niceMax - (niceMax * i) / steps);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
      ctx.fillText(String(val), pad.left - 8, y);
    }

    if (data.length === 0) return;

    // X positions
    const xFor = i => data.length === 1
      ? pad.left + w / 2
      : pad.left + (w * i) / (data.length - 1);
    const yFor = val => pad.top + h - (h * val) / niceMax;

    // New guests area (gold, semi-transparent bars)
    const barWidth = Math.min(22, (data.length > 1 ? w / data.length * 0.55 : 40));
    data.forEach((d, i) => {
      if (!d.newPeople) return;
      const cx = xFor(i);
      const by = yFor(d.newPeople);
      const bh = pad.top + h - by;
      ctx.fillStyle = 'rgba(232, 184, 75, 0.55)';
      ctx.fillRect(cx - barWidth / 2, by, barWidth, bh);
    });

    // Line — teal gradient fill under it
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    gradient.addColorStop(0, 'rgba(42, 171, 179, 0.25)');
    gradient.addColorStop(1, 'rgba(42, 171, 179, 0)');
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xFor(i);
      const y = yFor(d.total);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    // Close the area
    ctx.lineTo(xFor(data.length - 1), pad.top + h);
    ctx.lineTo(xFor(0), pad.top + h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line stroke
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xFor(i);
      const y = yFor(d.total);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#2AABB3';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots + value labels
    data.forEach((d, i) => {
      const x = xFor(i);
      const y = yFor(d.total);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#2AABB3';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#2D3436';
      ctx.font = 'bold 11px Karla, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(d.total), x, y - 8);
    });

    // X-axis labels (dates)
    ctx.fillStyle = '#8E99A4';
    ctx.font = '11px Karla, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelStep = Math.ceil(data.length / 8); // Avoid overcrowding
    data.forEach((d, i) => {
      if (i % labelStep !== 0 && i !== data.length - 1) return;
      const label = this._formatRetentionDate(d.date);
      ctx.fillText(label, xFor(i), pad.top + h + 8);
    });
  },

  // ---- Retention actions ----
  openRetentionText(personId, variant) {
    const person = this.data.people.find(p => p.id === personId);
    if (!person) { this.toast('Person not found'); return; }

    const firstName = person.firstName;
    let message;
    if (variant === 'ghosted') {
      message = `Hey ${firstName}! Noticed we haven't seen you at Bible study in a couple weeks. We've missed you — everything okay? No pressure, just wanted you to know the seat's still yours.`;
    } else {
      message = `Hey ${firstName}! Just wrapping up at St. Pete Bible Study tonight and realized you weren't here. Everything good? Would love to see you next Thursday!`;
    }

    // Prefer SMS link on mobile, fallback to clipboard copy
    const phone = (person.phone || '').replace(/[^+\d]/g, '');
    if (phone) {
      const smsUrl = `sms:${phone}${/iphone|ipad|mac/i.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(message)}`;
      window.open(smsUrl, '_blank');
    }

    navigator.clipboard?.writeText(message).then(() => this.toast('Message copied — opening SMS')).catch(() => {});
  },

  flagForFollowup(personId) {
    const person = this.data.people.find(p => p.id === personId);
    if (!person) return;
    db.updatePerson(personId, { needs_followup: true, followup_done: false })
      .then(() => this.refresh())
      .then(() => this.toast(`${person.firstName} flagged for follow-up`));
  },

  copyMissingList() {
    const missing = this.getMissingTonightList();
    if (missing.length === 0) { this.toast('No one missing tonight'); return; }
    const text = missing
      .map(r => `${r.name}${r.phone ? ' — ' + r.phone : ''} (${r.attendedWeeks} of last 3)`)
      .join('\n');
    navigator.clipboard?.writeText(text)
      .then(() => this.toast(`Copied ${missing.length} names`))
      .catch(() => this.toast('Copy failed'));
  },

  async assignAllGhosted() {
    const ghosted = this.getGhostedGuests();
    if (ghosted.length === 0) { this.toast('No ghosted guests right now'); return; }
    if (!confirm(`Mark all ${ghosted.length} ghosted guests as needing follow-up?`)) return;
    for (const g of ghosted) {
      try { await db.updatePerson(g.id, { needs_followup: true, followup_done: false }); }
      catch (e) { console.error(e); }
    }
    await this.refresh();
    this.toast(`Flagged ${ghosted.length} for follow-up`);
  },

  renderGamePlan() {
    const container = document.getElementById('gameplanMonths');
    if (!container) return;
    if (!this.data.gameplan) this.data.gameplan = this.loadGamePlan();
    if (!this.data.gameplanUI) this.data.gameplanUI = this.loadGamePlanUI();
    this.renderGamePlanStructures();
    this.renderGamePlanMonths();
    this.applyStructuresCollapse();
    this.updateGameplanPublishStatus();
  },

  loadGamePlanUI() {
    try {
      const saved = localStorage.getItem('stpete_gameplan_ui');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return { structuresOpen: false };
  },

  persistGamePlanUI() {
    localStorage.setItem('stpete_gameplan_ui', JSON.stringify(this.data.gameplanUI));
  },

  applyStructuresCollapse() {
    const card = document.getElementById('weekStructuresCard');
    if (!card) return;
    const open = this.data.gameplanUI && this.data.gameplanUI.structuresOpen;
    card.classList.toggle('collapsed', !open);
  },

  toggleStructuresCard() {
    if (!this.data.gameplanUI) this.data.gameplanUI = { structuresOpen: false };
    this.data.gameplanUI.structuresOpen = !this.data.gameplanUI.structuresOpen;
    this.persistGamePlanUI();
    this.applyStructuresCollapse();
  },

  renderGamePlanStructures() {
    const view = document.getElementById('weekStructuresView');
    if (!view) return;
    const canEdit = this.hasMinRole('editor');
    const editBtn = document.getElementById('editStructuresBtn');
    if (editBtn) editBtn.style.display = canEdit ? '' : 'none';

    const detailFields = [
      { key: 'music', label: 'Music' },
      { key: 'energy', label: 'Energy' },
      { key: 'conversation', label: 'Convo' },
      { key: 'seating', label: 'Seating' }
    ];

    view.innerHTML = this.data.gameplan.structures.map(s => {
      const d = s.details || {};
      const hasDetails = detailFields.some(f => (d[f.key] || '').trim());
      return `
      <div class="gp-struct-card ${this.escapeHtml(s.type)}">
        <div class="gp-struct-week">${this.escapeHtml(s.week)}</div>
        <div class="gp-struct-name">${this.escapeHtml(s.name)}</div>
        ${(s.times || []).map(t => `
          <div class="gp-struct-time">
            <span class="gp-struct-time-label">${this.escapeHtml(t.label || '')}</span>
            <span class="gp-struct-time-desc">${this.escapeHtml(t.desc || '')}</span>
          </div>
        `).join('')}
        ${s.goal ? `<div class="gp-struct-goal">${this.escapeHtml(s.goal)}</div>` : ''}
        ${hasDetails ? `
          <div class="gp-struct-details">
            ${detailFields.map(f => d[f.key] ? `
              <div class="gp-struct-detail">
                <div class="gp-struct-detail-label">${f.label}</div>
                <div class="gp-struct-detail-value">${this.escapeHtml(d[f.key])}</div>
              </div>
            ` : '').join('')}
          </div>
        ` : ''}
      </div>
    `; }).join('');

    const textarea = document.getElementById('weekStructuresEdit');
    if (textarea && document.activeElement !== textarea) {
      textarea.value = this.serializeStructures(this.data.gameplan.structures);
    }
  },

  serializeStructures(structures) {
    return structures.map(s => {
      const head = `${s.week} :: ${s.type} :: ${s.name}`;
      const times = (s.times || []).map(t => `${t.label || ''} | ${t.desc || ''}`).join('\n');
      const goal = s.goal ? `GOAL: ${s.goal}` : '';
      const d = s.details || {};
      const detailLines = [];
      if (d.music) detailLines.push(`MUSIC: ${d.music}`);
      if (d.energy) detailLines.push(`ENERGY: ${d.energy}`);
      if (d.conversation) detailLines.push(`CONVERSATION: ${d.conversation}`);
      if (d.seating) detailLines.push(`SEATING: ${d.seating}`);
      return [head, times, goal, detailLines.join('\n')].filter(Boolean).join('\n');
    }).join('\n\n');
  },

  parseStructuresText(text) {
    const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    return blocks.map(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const head = lines[0].split('::').map(s => s.trim());
      const week = head[0] || '';
      const type = (head[1] || 'community').toLowerCase();
      const name = head[2] || '';
      const times = [];
      let goal = '';
      const details = { music: '', energy: '', conversation: '', seating: '' };
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^(GOAL|MUSIC|ENERGY|CONVERSATION|CONVO|SEATING)\s*:\s*(.*)$/i);
        if (m) {
          const key = m[1].toUpperCase();
          const val = m[2].trim();
          if (key === 'GOAL') goal = val;
          else if (key === 'MUSIC') details.music = val;
          else if (key === 'ENERGY') details.energy = val;
          else if (key === 'CONVERSATION' || key === 'CONVO') details.conversation = val;
          else if (key === 'SEATING') details.seating = val;
        } else {
          const parts = line.split('|').map(p => p.trim());
          times.push({ label: parts[0] || '', desc: parts.slice(1).join(' | ') || parts[0] || '' });
        }
      }
      return { week, type, name, times, goal, details };
    }).filter(Boolean);
  },

  toggleEditStructures() {
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }
    const view = document.getElementById('weekStructuresView');
    const edit = document.getElementById('weekStructuresEdit');
    const btn = document.getElementById('editStructuresBtn');
    if (!view || !edit || !btn) return;
    if (edit.style.display === 'none') {
      edit.value = this.serializeStructures(this.data.gameplan.structures);
      edit.style.display = '';
      view.style.display = 'none';
      btn.textContent = 'Done';
    } else {
      edit.style.display = 'none';
      view.style.display = '';
      btn.textContent = 'Edit';
      this.renderGamePlanStructures();
    }
  },

  saveGamePlanField(field) {
    if (!this.hasMinRole('editor')) return;
    if (field === 'structures') {
      const text = document.getElementById('weekStructuresEdit').value;
      const parsed = this.parseStructuresText(text);
      if (parsed.length) {
        this.data.gameplan.structures = parsed;
        this.persistGamePlan();
      }
    }
  },

  renderGamePlanMonths() {
    const container = document.getElementById('gameplanMonths');
    if (!container) return;
    const canEdit = this.hasMinRole('editor');
    const now = new Date();
    const currentMonthKey = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const thisWeekKey = this.getCurrentThursdayKey(now);

    container.innerHTML = this.data.gameplan.months.map(m => {
      const isCurrent = m.name === currentMonthKey;
      const openClass = isCurrent ? ' open' : '';
      return `
      <div class="gp-month${openClass}" id="gpmonth-${this.escapeHtml(m.id)}">
        <div class="gp-month-card">
          <div class="gp-month-header" onclick="app.toggleGamePlanMonth('${m.id}')">
            <div>
              <div class="gp-month-name">${this.escapeHtml(m.name)}</div>
              <div class="gp-month-count">${m.weeks.length} Thursday${m.weeks.length === 1 ? '' : 's'}</div>
            </div>
            <span class="gp-month-chevron">▶</span>
          </div>
          <div class="gp-month-body">
            ${m.weeks.map((w, wIdx) => {
              const isThisWeek = w.date === thisWeekKey;
              const isPast = !isThisWeek && this.isGamePlanDatePast(w.date, m.name);
              const cls = isThisWeek ? 'thisweek' : (isPast ? 'past' : '');
              const assignedCount = (w.flow || []).filter(f => (f.person || '').trim()).length;
              const assignedBadge = assignedCount > 0
                ? `<span style="font-size:0.68rem; color:var(--gray-500); margin-left:8px; white-space:nowrap;">${assignedCount} assigned</span>`
                : '';
              return `
                <div class="gp-week-row ${cls}" onclick="app.openWeekDetail('${m.id}', ${wIdx})">
                  <div class="gp-week-date">${this.escapeHtml(w.date)}</div>
                  <span class="gp-week-type-badge ${this.escapeHtml(w.type)}">${this.escapeHtml(w.type)}</span>
                  <div class="gp-week-desc">${this.renderInlineMd(w.desc || '')}${assignedBadge}</div>
                </div>
              `;
            }).join('')}
            ${canEdit ? `<div style="text-align:right;margin-top:12px;"><button class="btn-ghost" onclick="app.toggleEditGamePlanMonth('${m.id}')" style="font-size:0.75rem;">Edit this month</button></div>` : ''}
          </div>
          <div class="gp-month-edit-wrap">
            <div style="font-size:0.72rem;color:var(--gray-500);margin-bottom:6px;">Format: <code>Date | type | description</code> — one per line. Types: community, growth, groups, invite, serve.</div>
            <textarea class="gp-month-edit-area" id="gpedit-${this.escapeHtml(m.id)}"></textarea>
            <div class="gp-month-edit-actions">
              <button class="gp-edit-cancel" onclick="app.cancelEditGamePlanMonth('${m.id}')">Cancel</button>
              <button class="gp-edit-save" onclick="app.saveEditGamePlanMonth('${m.id}')">Save</button>
            </div>
          </div>
        </div>
      </div>
    `; }).join('');
  },

  getCurrentThursdayKey(now) {
    const d = new Date(now);
    const day = d.getDay();
    let diff = 4 - day;
    if (diff < 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  },

  isGamePlanDatePast(dateStr, monthYearStr) {
    try {
      const parts = monthYearStr.split(' ');
      const year = parseInt(parts[parts.length - 1], 10);
      const d = new Date(`${dateStr}, ${year}`);
      if (isNaN(d.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d < today;
    } catch(e) { return false; }
  },

  toggleGamePlanMonth(id) {
    const el = document.getElementById('gpmonth-' + id);
    if (el) el.classList.toggle('open');
  },

  toggleEditGamePlanMonth(id) {
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }
    const el = document.getElementById('gpmonth-' + id);
    const month = this.data.gameplan.months.find(m => m.id === id);
    if (!el || !month) return;
    const textarea = document.getElementById('gpedit-' + id);
    textarea.value = month.weeks.map(w => `${w.date} | ${w.type} | ${w.desc}`).join('\n');
    el.classList.add('editing');
  },

  cancelEditGamePlanMonth(id) {
    const el = document.getElementById('gpmonth-' + id);
    if (el) el.classList.remove('editing');
  },

  saveEditGamePlanMonth(id) {
    if (!this.hasMinRole('editor')) return;
    const textarea = document.getElementById('gpedit-' + id);
    if (!textarea) return;
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const weeks = lines.map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        date: parts[0] || '',
        type: (parts[1] || 'community').toLowerCase(),
        desc: parts.slice(2).join(' | ') || ''
      };
    });
    const month = this.data.gameplan.months.find(m => m.id === id);
    if (month) {
      month.weeks = weeks;
      this.persistGamePlan();
      this.renderGamePlanMonths();
      this.toast('Month saved');
    }
  },

  renderInlineMd(text) {
    if (!text) return '';
    return this.escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  },

  // ---- WEEK DETAIL MODAL ----
  weekDetailContext: null,

  openWeekDetail(monthId, weekIdx) {
    if (!this.data.gameplan) return;
    const month = this.data.gameplan.months.find(m => m.id === monthId);
    if (!month) return;
    const week = month.weeks[weekIdx];
    if (!week) return;

    // Seed flow from matching structure if this week has none yet
    if (!Array.isArray(week.flow) || week.flow.length === 0) {
      const structure = (this.data.gameplan.structures || []).find(s => s.type === week.type);
      if (structure && Array.isArray(structure.times)) {
        week.flow = structure.times.map(t => ({
          time: t.label || '',
          desc: t.desc || '',
          person: ''
        }));
      } else {
        week.flow = [];
      }
      this.persistGamePlan();
    }

    this.weekDetailContext = { monthId, weekIdx };
    this.renderWeekDetail();
    document.getElementById('weekDetailModal').classList.add('show');
  },

  renderWeekDetail() {
    const ctx = this.weekDetailContext;
    if (!ctx) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week) return;

    const structure = (this.data.gameplan.structures || []).find(s => s.type === week.type);
    const canEdit = this.hasMinRole('editor');

    // Full date parsing
    let dateFull = week.date;
    try {
      const year = parseInt(month.name.split(' ').pop(), 10);
      const d = new Date(`${week.date}, ${year}`);
      if (!isNaN(d.getTime())) {
        dateFull = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      }
    } catch(e) {}

    document.getElementById('weekDetailTitle').textContent = dateFull;

    const structName = structure ? structure.name : week.type;
    const typeOptions = [
      { value: 'community', label: 'Community' },
      { value: 'growth', label: 'Growth' },
      { value: 'groups', label: 'Groups' },
      { value: 'invite', label: 'Invite / Fun' },
      { value: 'serve', label: 'Serve' }
    ];

    let html = '';

    // Hero
    if (canEdit) {
      html += `<div class="wk-detail-hero">
        <div class="wk-hero-top">
          <select class="wk-type-select ${this.escapeHtml(week.type)}" onchange="app.updateWeekField('type', this.value)">
            ${typeOptions.map(o => `<option value="${o.value}" ${week.type === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="wk-reset-flow" onclick="app.duplicateWeek()" title="Make a copy of this week at the end of the month">Duplicate</button>
            <button class="wk-reset-flow" onclick="app.resetWeekFlowFromType()" title="Replace flow with default for this night type">Reset flow</button>
            <button class="wk-reset-flow" style="background:#FEF2F2;color:#DC2626;border-color:#FECACA;" onclick="app.deleteWeek()" title="Delete this week">Delete</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
          <label style="font-size:0.7rem;color:var(--gray-500);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Date</label>
          <input type="text" class="wk-flow-time" style="flex:1;min-width:120px;" value="${this.escapeHtml(week.date || '')}" placeholder="e.g. Apr 2" oninput="app.updateWeekField('date', this.value)" title="Short date label used in the calendar (e.g. 'Apr 2')">
        </div>
        <div class="wk-detail-hero-title" style="margin-top:10px;">${this.escapeHtml(structName)}</div>
        <textarea class="wk-desc-edit" placeholder="Week description (e.g. **Growth Night** — What does a healthy campus look like?)" oninput="app.updateWeekField('desc', this.value)">${this.escapeHtml(week.desc || '')}</textarea>
        ${structure && structure.goal ? `<div class="wk-detail-hero-desc" style="font-style:italic; color:var(--gray-500);">${this.escapeHtml(structure.goal)}</div>` : ''}
      </div>`;
    } else {
      html += `<div class="wk-detail-hero">
        <span class="gp-week-type-badge ${this.escapeHtml(week.type)}">${this.escapeHtml(week.type)}</span>
        <div class="wk-detail-hero-title">${this.escapeHtml(structName)}</div>
        ${week.desc ? `<div class="wk-detail-hero-desc">${this.renderInlineMd(week.desc)}</div>` : ''}
        ${structure && structure.goal ? `<div class="wk-detail-hero-desc" style="font-style:italic; color:var(--gray-500);">${this.escapeHtml(structure.goal)}</div>` : ''}
      </div>`;
    }

    // Flow (editable rows with time / desc / person)
    html += `<div class="wk-detail-section">
      <div class="wk-detail-label"><span>Flow</span></div>`;

    if (!week.flow || week.flow.length === 0) {
      html += `<div style="font-size:0.85rem; color:var(--gray-500); font-style:italic;">No flow yet.${canEdit ? ' Click + Add Row below.' : ''}</div>`;
    } else if (canEdit) {
      html += `<div class="wk-flow-header">
        <span class="wk-flow-col-time">Time</span>
        <span class="wk-flow-col-desc">What's happening</span>
        <span class="wk-flow-col-person">Who</span>
        <span class="wk-flow-col-remove"></span>
      </div>`;
      html += week.flow.map((f, idx) => `
        <div class="wk-flow-row">
          <input class="wk-flow-time" type="text" value="${this.escapeHtml(f.time || '')}" placeholder="6:30" oninput="app.updateFlowItem(${idx}, 'time', this.value)">
          <input class="wk-flow-desc" type="text" value="${this.escapeHtml(f.desc || '')}" placeholder="What's happening?" oninput="app.updateFlowItem(${idx}, 'desc', this.value)">
          <input class="wk-flow-person" type="text" list="wkPeopleList" value="${this.escapeHtml(f.person || '')}" placeholder="Assign…" oninput="app.updateFlowItem(${idx}, 'person', this.value)">
          <button class="wk-flow-remove" onclick="app.removeFlowItem(${idx})" title="Remove">×</button>
        </div>
      `).join('');
      html += `<datalist id="wkPeopleList">${this.teamMembers.map(m => `<option value="${this.escapeHtml(m)}">`).join('')}</datalist>`;
      html += `<button class="wk-add-btn" onclick="app.addFlowItem()">+ Add Row</button>`;
    } else {
      // Read-only view
      html += week.flow.map(f => `
        <div class="wk-flow-row-view">
          <span class="wk-flow-time-view">${this.escapeHtml(f.time || '')}</span>
          <span class="wk-flow-desc-view">${this.escapeHtml(f.desc || '')}</span>
          <span class="wk-flow-person-view ${(f.person || '').trim() ? '' : 'unassigned'}">${(f.person || '').trim() ? this.escapeHtml(f.person) : '—'}</span>
        </div>
      `).join('');
    }

    html += `</div>`;

    document.getElementById('weekDetailBody').innerHTML = html;
  },

  addFlowItem() {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week) return;
    if (!week.flow) week.flow = [];
    week.flow.push({ time: '', desc: '', person: '' });
    this.persistGamePlan();
    this.renderWeekDetail();
  },

  updateFlowItem(idx, field, value) {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week || !week.flow || !week.flow[idx]) return;
    week.flow[idx][field] = value;
    clearTimeout(this._weekSaveTimer);
    this._weekSaveTimer = setTimeout(() => {
      this.persistGamePlan();
      this.renderGamePlanMonths();
    }, 400);
  },

  removeFlowItem(idx) {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week || !week.flow) return;
    week.flow.splice(idx, 1);
    this.persistGamePlan();
    this.renderWeekDetail();
    this.renderGamePlanMonths();
  },

  updateWeekField(field, value) {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week) return;
    week[field] = value;
    clearTimeout(this._weekSaveTimer);
    this._weekSaveTimer = setTimeout(() => {
      this.persistGamePlan();
      this.renderGamePlanMonths();
    }, 400);
    // For type changes, refresh the modal immediately so the badge/title update
    if (field === 'type') {
      this.persistGamePlan();
      this.renderWeekDetail();
      this.renderGamePlanMonths();
    }
  },

  resetWeekFlowFromType() {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week) return;
    if (!confirm('Replace this week\'s flow with the default for "' + week.type + '" night? Any custom rows and assignees will be lost.')) return;
    const structure = (this.data.gameplan.structures || []).find(s => s.type === week.type);
    if (structure && Array.isArray(structure.times)) {
      week.flow = structure.times.map(t => ({
        time: t.label || '',
        desc: t.desc || '',
        person: ''
      }));
    } else {
      week.flow = [];
    }
    this.persistGamePlan();
    this.renderWeekDetail();
    this.renderGamePlanMonths();
  },

  duplicateWeek() {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week) return;
    // Deep-clone
    const copy = JSON.parse(JSON.stringify(week));
    copy.desc = (copy.desc || '') + (copy.desc ? ' (copy)' : '(copy)');
    month.weeks.splice(ctx.weekIdx + 1, 0, copy);
    this.persistGamePlan();
    // Point the modal at the new copy so Kody can edit date + details immediately
    this.weekDetailContext = { monthId: ctx.monthId, weekIdx: ctx.weekIdx + 1 };
    this.renderWeekDetail();
    this.renderGamePlanMonths();
    this.toast('Week duplicated — change the date on the copy.');
  },

  deleteWeek() {
    const ctx = this.weekDetailContext;
    if (!ctx || !this.hasMinRole('editor')) return;
    const month = this.data.gameplan.months.find(m => m.id === ctx.monthId);
    if (!month) return;
    const week = month.weeks[ctx.weekIdx];
    if (!week) return;
    if (!confirm(`Delete the week "${week.date}" from ${month.name}? This cannot be undone.`)) return;
    month.weeks.splice(ctx.weekIdx, 1);
    this.persistGamePlan();
    this.closeModal('weekDetailModal');
    this.renderGamePlanMonths();
    this.toast('Week deleted');
  },

  // ---- CHANGE PASSWORD ----
  async hashPassword(userId, password) {
    const enc = new TextEncoder().encode(`${userId}:${password}`);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  openChangePasswordModal() {
    document.getElementById('pwdCurrent').value = '';
    document.getElementById('pwdNew').value = '';
    document.getElementById('pwdConfirm').value = '';
    document.getElementById('pwdError').textContent = '';
    document.getElementById('changePasswordModal').classList.add('show');
    setTimeout(() => document.getElementById('pwdCurrent').focus(), 150);
  },

  async submitChangePassword() {
    const errEl = document.getElementById('pwdError');
    errEl.textContent = '';
    const current = document.getElementById('pwdCurrent').value;
    const next = document.getElementById('pwdNew').value;
    const confirm = document.getElementById('pwdConfirm').value;
    const userId = this.currentUser?.userId;
    if (!userId) { errEl.textContent = 'No active session.'; return; }
    if (!current || !next || !confirm) { errEl.textContent = 'Fill in all three fields.'; return; }
    if (next.length < 8) { errEl.textContent = 'New password must be at least 8 characters.'; return; }
    if (next !== confirm) { errEl.textContent = 'New passwords don\'t match.'; return; }

    // Verify current password against DB hash
    const row = await db.getTeamRoleById(userId);
    if (!row) { errEl.textContent = 'Could not load your account.'; return; }
    const currentHash = await this.hashPassword(userId, current);
    if (row.password_hash && row.password_hash !== currentHash) {
      errEl.textContent = 'Current password is incorrect.';
      return;
    }

    const newHash = await this.hashPassword(userId, next);
    try {
      await db.updatePassword(userId, newHash);
      this.closeModal('changePasswordModal');
      this.toast('Password updated. Use it next time you sign in.');
    } catch (err) {
      errEl.textContent = 'Save failed. Try again.';
    }
  },

  // ---- POLLS ----
  async renderPolls() {
    const listEl = document.getElementById('pollsList');
    if (!listEl) return;
    const polls = this.data.polls || [];
    if (polls.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No polls yet. Click "+ New Poll" to create one.</p>';
      return;
    }

    // Fetch vote counts for each poll in parallel
    const voteLists = await Promise.all(polls.map(p => db.getPollVotes(p.id)));
    const voteCounts = voteLists.map(votes => {
      const counts = {};
      (votes || []).forEach(v => { counts[v.option_index] = (counts[v.option_index] || 0) + 1; });
      return { counts, total: (votes || []).length };
    });

    listEl.innerHTML = polls.map((p, i) => {
      const { counts, total } = voteCounts[i];
      const opts = Array.isArray(p.options) ? p.options : [];
      const bars = opts.map((opt, idx) => {
        const n = counts[idx] || 0;
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return `
          <div class="poll-bar-row">
            <div class="poll-bar-label">${this.escapeHtml(opt)}</div>
            <div class="poll-bar-track"><div class="poll-bar-fill" style="width:${pct}%;"></div></div>
            <div class="poll-bar-count">${n} · ${pct}%</div>
          </div>
        `;
      }).join('');
      const pubBadge = p.is_published
        ? '<span class="poll-pub-badge live">● Live on public site</span>'
        : '<span class="poll-pub-badge">Draft</span>';
      return `
        <div class="poll-admin-card">
          <div class="poll-admin-head">
            <div>
              <div class="poll-admin-q">${this.escapeHtml(p.question)}</div>
              ${p.description ? `<div class="poll-admin-desc">${this.escapeHtml(p.description)}</div>` : ''}
              ${pubBadge}
              <span class="poll-admin-meta">${total} vote${total === 1 ? '' : 's'}</span>
            </div>
            <div class="poll-admin-actions">
              <button class="btn-ghost" onclick="app.togglePollPublished('${p.id}', ${!p.is_published})" style="font-size:0.72rem;">${p.is_published ? 'Unpublish' : 'Publish'}</button>
              <button class="btn-ghost" onclick="app.deletePoll('${p.id}')" style="font-size:0.72rem;color:#DC2626;">Delete</button>
            </div>
          </div>
          <div class="poll-bars">${bars}</div>
        </div>
      `;
    }).join('');
  },

  openPollModal(editId) {
    document.getElementById('pollModalTitle').textContent = editId ? 'Edit Poll' : 'Create Poll';
    document.getElementById('pollQuestion').value = '';
    document.getElementById('pollDescription').value = '';
    document.getElementById('pollOptionsText').value = '';
    document.getElementById('pollMultiSelect').checked = false;
    document.getElementById('pollPublishNow').checked = true;
    this._editingPollId = editId || null;
    document.getElementById('pollModal').classList.add('show');
    setTimeout(() => document.getElementById('pollQuestion').focus(), 150);
  },

  async savePoll() {
    if (!this.hasMinRole('editor')) { this.toast('Editor access required'); return; }
    const question = document.getElementById('pollQuestion').value.trim();
    const description = document.getElementById('pollDescription').value.trim();
    const optionsText = document.getElementById('pollOptionsText').value;
    const multiSelect = document.getElementById('pollMultiSelect').checked;
    const publishNow = document.getElementById('pollPublishNow').checked;
    const options = optionsText.split('\n').map(s => s.trim()).filter(Boolean);

    if (!question) { this.toast('Question is required'); return; }
    if (options.length < 2) { this.toast('Add at least 2 options'); return; }

    const body = {
      question,
      description,
      options,
      multi_select: multiSelect,
      is_published: publishNow,
      is_active: true,
      created_by: this.currentUser?.userId || null
    };
    try {
      await db.createPoll(body);
      this.closeModal('pollModal');
      this.toast(publishNow ? 'Poll published!' : 'Poll saved as draft');
      this.data.polls = await db.getPolls();
      this.renderPolls();
    } catch (err) {
      this.toast('Save failed');
    }
  },

  async togglePollPublished(id, published) {
    if (!this.hasMinRole('editor')) return;
    await db.updatePoll(id, { is_published: published });
    this.data.polls = await db.getPolls();
    this.renderPolls();
    this.toast(published ? 'Poll published' : 'Poll unpublished');
  },

  async deletePoll(id) {
    if (!this.hasMinRole('editor')) return;
    if (!confirm('Delete this poll and all its votes? This cannot be undone.')) return;
    await db.deletePoll(id);
    this.data.polls = await db.getPolls();
    this.renderPolls();
    this.toast('Poll deleted');
  },

  // ---- GENERIC MODAL CLOSER ----
  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }
};

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

/* ================================================================
   SEASON PLANNER
   ================================================================ */
Object.assign(app, {
  _plannerRows: [],
  _plannerSaveTimers: {},

  async renderPlanner() {
    const tbody = document.getElementById('plannerBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="planner-empty">Loading...</td></tr>';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/season_plan?order=sort_order.asc,session_date.asc`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
      this._plannerRows = await res.json();
    } catch(e) { this._plannerRows = []; }
    this._renderPlannerTable();
  },

  _renderPlannerTable() {
    const tbody = document.getElementById('plannerBody');
    if (!tbody) return;
    const rows = this._plannerRows;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="planner-empty">No sessions yet — click <strong>+ Add Session</strong> to start planning.</td></tr>';
      return;
    }
    const cols = ['session_date','icebreaker_game','teaching_focus','speaker','dev_focus','notes'];
    const placeholders = ['Date (e.g. May 1)','Icebreaker Game','Teaching Focus','Speaker','Dev Focus','Notes'];
    tbody.innerHTML = rows.map(row => `
      <tr data-planner-id="${row.id}">
        ${cols.map((col, i) => `
          <td>
            <input class="planner-cell" value="${(row[col]||'').replace(/"/g,'&quot;')}"
              placeholder="${placeholders[i]}"
              onchange="app._savePlannerCell('${row.id}','${col}',this.value)"
              onblur="app._savePlannerCell('${row.id}','${col}',this.value)">
          </td>`).join('')}
        <td style="text-align:center;">
          <button class="planner-delete" onclick="app.deletePlannerRow('${row.id}')" title="Delete row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </td>
      </tr>`).join('');
  },

  _savePlannerCell(id, col, value) {
    const row = this._plannerRows.find(r => r.id === id);
    if (!row || row[col] === value) return;
    row[col] = value;
    clearTimeout(this._plannerSaveTimers[id]);
    this._plannerSaveTimers[id] = setTimeout(async () => {
      await fetch(`${SUPABASE_URL}/rest/v1/season_plan?id=eq.${id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ [col]: value })
      });
    }, 600);
  },

  async addPlannerRow() {
    const sort_order = this._plannerRows.length;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/season_plan`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ session_date: '', icebreaker_game: '', teaching_focus: '', speaker: '', dev_focus: '', notes: '', sort_order })
    });
    const [newRow] = await res.json();
    this._plannerRows.push(newRow);
    this._renderPlannerTable();
    // Focus the first cell of the new row
    const tbody = document.getElementById('plannerBody');
    if (tbody) {
      const lastRow = tbody.querySelector('tr:last-child');
      if (lastRow) lastRow.querySelector('.planner-cell')?.focus();
    }
  },

  async deletePlannerRow(id) {
    if (!confirm('Delete this session row?')) return;
    await fetch(`${SUPABASE_URL}/rest/v1/season_plan?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    this._plannerRows = this._plannerRows.filter(r => r.id !== id);
    this._renderPlannerTable();
  }
});

/* ================================================================
   GROWTH & ATTENDANCE CHARTS
   ================================================================ */
Object.assign(app, {
  async renderGrowth() {
    const statsEl = document.getElementById('growthStats');
    const chartEl = document.getElementById('growthChart');
    const tableEl = document.getElementById('growthTable');
    if (!statsEl || !chartEl || !tableEl) return;
    statsEl.innerHTML = '<div style="padding:16px;color:var(--gray-500);font-size:0.85rem;">Loading...</div>';

    let records = [];
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/attendance?order=date.asc`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
      records = await res.json();
    } catch(e) {}

    if (!records.length) {
      statsEl.innerHTML = '<div style="padding:32px;color:var(--gray-500);text-align:center;">No attendance data yet. Check people in via the kiosk to start tracking growth.</div>';
      chartEl.innerHTML = '';
      tableEl.innerHTML = '';
      return;
    }

    const totals = records.map(r => Array.isArray(r.checked_in) ? r.checked_in.length : (r.total || 0));
    const newCounts = records.map(r => r.new_people || 0);
    const allTotal = totals.reduce((a,b)=>a+b,0);
    const avg = records.length ? Math.round(allTotal / records.length) : 0;
    const best = Math.max(...totals);
    const totalNew = newCounts.reduce((a,b)=>a+b,0);
    const latest = records[records.length-1];
    const latestTotal = totals[totals.length-1];
    const prev = totals.length > 1 ? totals[totals.length-2] : null;
    const trend = prev !== null ? latestTotal - prev : null;

    // Stats row
    statsEl.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;">
        ${this._growthStat('Last Session', latestTotal, trend !== null ? (trend >= 0 ? `+${trend} vs prev` : `${trend} vs prev`) : 'First session', trend > 0 ? 'var(--teal)' : trend < 0 ? '#e74c3c' : 'var(--gray-500)')}
        ${this._growthStat('Avg Attendance', avg, 'per session')}
        ${this._growthStat('Best Session', best, 'all time high')}
        ${this._growthStat('Total Sessions', records.length, `${totalNew} new people total`)}
      </div>`;

    // Bar chart
    const maxVal = Math.max(...totals, 1);
    const bars = records.map((r, i) => {
      const total = totals[i];
      const newP = newCounts[i];
      const ret = Math.max(0, total - newP);
      const newPct = Math.round((newP / maxVal) * 100);
      const retPct = Math.round((ret / maxVal) * 100);
      const label = r.date ? r.date.replace(/^\d{4}-/, '').replace('-','/') : '?';
      return `<div class="growth-bar-col" title="${r.date}: ${total} total, ${newP} new">
        <div class="growth-bar-count">${total || ''}</div>
        <div class="growth-bar-stack">
          ${newP ? `<div class="growth-bar growth-bar-new" style="height:${newPct}%;min-height:${newP?'4px':'0'};"></div>` : ''}
          ${ret  ? `<div class="growth-bar growth-bar-returning" style="height:${retPct}%;min-height:${ret?'4px':'0'};"></div>` : ''}
        </div>
        <div class="growth-bar-label">${label}</div>
      </div>`;
    }).join('');
    chartEl.innerHTML = `
      <div style="margin-bottom:10px;display:flex;gap:16px;font-size:0.75rem;color:var(--gray-500);">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--teal);margin-right:4px;vertical-align:middle;"></span>New</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#b2e8eb;margin-right:4px;vertical-align:middle;"></span>Returning</span>
      </div>
      <div class="growth-bar-wrap">${bars}</div>`;

    // History table
    const tableRows = [...records].reverse().map(r => {
      const total = Array.isArray(r.checked_in) ? r.checked_in.length : (r.total || 0);
      const newP = r.new_people || 0;
      return `<tr>
        <td>${r.date || '—'}</td>
        <td style="font-weight:700;">${total}</td>
        <td>${newP > 0 ? `<span style="color:var(--teal);font-weight:700;">+${newP} new</span>` : '—'}</td>
        <td>${Math.max(0, total - newP)}</td>
      </tr>`;
    }).join('');
    tableEl.innerHTML = `<table class="growth-history-table">
      <thead><tr><th>Date</th><th>Total</th><th>New</th><th>Returning</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  },

  _growthStat(label, value, sub, subColor) {
    return `<div class="growth-stat-card">
      <div class="growth-stat-label">${label}</div>
      <div class="growth-stat-value">${value}</div>
      <div class="growth-stat-sub" style="${subColor?`color:${subColor};font-weight:700;`:''}">${sub}</div>
    </div>`;
  }
});

// Init
document.addEventListener('DOMContentLoaded', () => app.init().catch(console.error));
