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

  // ---- INIT ----
  async init() {
    if (!this.checkAuth()) return;
    this._reachedOut = JSON.parse(localStorage.getItem('stpete_reached_out') || '{}');
    await this.loadData();
    this.setupNavigation();
    this.setupMobileMenu();
    this.setupCSVDrop();
    this.renderAll();
    this.setNextThursday();
  },

  checkAuth() {
    const session = JSON.parse(localStorage.getItem('stpete_session') || 'null');
    if (!session || !session.loggedIn) {
      // Only redirect if we're not already on the login page
      if (!window.location.pathname.includes('login')) {
        window.location.href = 'login.html';
      }
      return false;
    }
    this.currentUser = session;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = session.name;
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
        db.getPastWeeks()
      ]);

      const val = (i) => results[i].status === 'fulfilled' ? results[i].value : null;

      this.data.people = (val(0) || []).map(r => db.personFromRow(r));
      this.data.attendance = (val(1) || []).map(r => db.attendanceFromRow(r));
      this.data.teams = val(2) || [];
      this.data.teamMembersData = val(3) || [];
      this.data.groups = val(4) || [];
      this.data.weeklyPrep = val(5) || { topic: '', scripture: '', takeaway: '', cta: '', icebreaker: '', questions: [] };
      this.data.pastWeeks = val(6) || [];
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
      weekly: 'Weekly Prep',
      teams: 'Teams',
      groups: 'Microgroups',
      timeline: 'Launch Timeline'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Re-render page-specific content
    this.renderAll();
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
            <button class="followup-done-btn" onclick="app.markFollowedUp('${p.id}')">Done</button>
          </div>
        `).join('');
      }
    }
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

    const prep = {
      id: this.data.weeklyPrep?.id || undefined,
      topic: document.getElementById('weekTopic')?.value || '',
      scripture: document.getElementById('weekScripture')?.value || '',
      takeaway: document.getElementById('weekTakeaway')?.value || '',
      cta: document.getElementById('weekCTA')?.value || '',
      icebreaker: this.data.weeklyPrep?.icebreaker || '',
      questions,
      message_notes: document.getElementById('weekMessageNotes')?.value || '',
      is_published: this.data.weeklyPrep?.is_published || false
    };

    const result = await db.upsertWeeklyPrep(prep);
    if (result && result[0]) {
      this.data.weeklyPrep = result[0];
    }

    const topicEl = document.getElementById('weeklyTopic');
    if (topicEl && prep.topic) topicEl.textContent = prep.topic;
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

    // Restore saved icebreaker
    const ibOutput = document.getElementById('icebreakerOutput');
    if (ibOutput && wp.icebreaker && ibOutput.querySelector('.placeholder-text')) {
      ibOutput.innerHTML = `<p style="font-size:1rem; font-weight:500; color:var(--slate);">"${wp.icebreaker}"</p>`;
    }

    const topicEl = document.getElementById('weeklyTopic');
    if (topicEl) {
      topicEl.textContent = wp.topic || 'Set this week\'s topic in Weekly Prep';
    }

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

  async generateIcebreaker() {
    const icebreaker = Generators.getIcebreaker();
    const output = document.getElementById('icebreakerOutput');
    output.innerHTML = `<p style="font-size:1rem; font-weight:500; color:var(--slate);">"${icebreaker}"</p>`;
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
  archiveWeek() {
    const wp = this.data.weeklyPrep;
    if (!wp.topic) return;

    this.data.pastWeeks.unshift({
      topic: wp.topic,
      scripture: wp.scripture,
      takeaway: wp.takeaway,
      cta: wp.cta,
      icebreaker: wp.icebreaker,
      questions: wp.questions,
      date: new Date().toISOString().split('T')[0]
    });

    // Reset current
    this.data.weeklyPrep = {
      topic: '', scripture: '', takeaway: '', cta: '',
      icebreaker: '', questions: [], date: ''
    };

    this.saveData();
    this.renderAll();
    this.toast('Week archived');
  },

  renderPastWeeks() {
    const container = document.getElementById('pastWeeks');
    if (!container) return;

    if (this.data.pastWeeks.length === 0) {
      container.innerHTML = '<p class="empty-state">Past week preps will appear here as you use Weekly Prep.</p>';
      return;
    }

    container.innerHTML = this.data.pastWeeks.map(w => `
      <div class="past-week-item">
        <div class="past-week-item-info">
          <span class="past-week-item-topic">${w.topic || 'Untitled'}</span>
          <span class="past-week-item-date">${w.date || w.created_at?.split('T')[0] || ''} · ${w.scripture || 'No scripture'}</span>
        </div>
      </div>
    `).join('');
  },

  // ---- TEAMS ----
  renderTeams() {
    const grid = document.getElementById('teamsGrid');
    if (!grid) return;

    const teams = this.data.teams;
    const members = this.data.teamMembersData;

    grid.innerHTML = teams.map(team => {
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

    if (checkinPresent) checkinPresent.textContent = checked;
    if (checkinTotal) checkinTotal.textContent = this.data.people.length;

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

  showAttendanceDetail(idx) {
    const record = this.data.attendance[idx];
    if (!record) return;

    const date = new Date(record.date + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    document.getElementById('attendanceModalTitle').textContent = dateStr;

    // Stats bar
    const pct = record.total > 0 ? Math.round((record.checkedIn.length / record.total) * 100) : 0;
    document.getElementById('attendanceDetailStats').innerHTML = `
      <div style="display:flex; gap:24px; padding:16px 24px; background:var(--gray-100); justify-content:center;">
        <div style="text-align:center;"><strong style="font-size:1.3rem; color:var(--teal-dark);">${record.checkedIn.length}</strong><br><span style="font-size:0.72rem; color:var(--gray-500); text-transform:uppercase; font-weight:600;">Present</span></div>
        <div style="text-align:center;"><strong style="font-size:1.3rem; color:var(--pink);">${record.newPeople || 0}</strong><br><span style="font-size:0.72rem; color:var(--gray-500); text-transform:uppercase; font-weight:600;">New</span></div>
        <div style="text-align:center;"><strong style="font-size:1.3rem; color:var(--gold);">${pct}%</strong><br><span style="font-size:0.72rem; color:var(--gray-500); text-transform:uppercase; font-weight:600;">of ${record.total}</span></div>
      </div>
    `;

    // People list
    const people = record.checkedIn.map(id => this.data.people.find(p => p.id === id)).filter(Boolean);
    const absent = this.data.people.filter(p => !record.checkedIn.includes(p.id));

    let html = '<div style="padding:16px 24px;">';
    html += '<div style="font-size:0.75rem; font-weight:700; color:var(--teal-dark); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Present (' + people.length + ')</div>';
    html += people.sort((a, b) => a.firstName.localeCompare(b.firstName)).map(p => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--gray-100);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span style="font-size:0.85rem; font-weight:500; color:var(--slate);">${p.firstName} ${p.lastName || ''}</span>
        <span style="font-size:0.72rem; color:var(--gray-500); margin-left:auto;">${this.capitalize(p.status)}</span>
      </div>
    `).join('');

    if (absent.length > 0) {
      html += '<div style="font-size:0.75rem; font-weight:700; color:var(--gray-500); text-transform:uppercase; letter-spacing:1px; margin:16px 0 8px;">Absent (' + absent.length + ')</div>';
      html += absent.sort((a, b) => a.firstName.localeCompare(b.firstName)).map(p => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--gray-100); opacity:0.5;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span style="font-size:0.85rem; font-weight:500; color:var(--gray-600);">${p.firstName} ${p.lastName || ''}</span>
        </div>
      `).join('');
    }

    html += '</div>';
    document.getElementById('attendanceDetailList').innerHTML = html;

    document.getElementById('attendanceModal').classList.add('show');
  },

  // ---- PAST CHECK-IN ----
  pastCheckinState: {},

  openPastCheckinModal() {
    this.pastCheckinState = {};
    document.getElementById('pastCheckinDate').value = '';
    document.getElementById('pastCheckinSearch').value = '';
    this.renderPastCheckinList();
    document.getElementById('pastCheckinModal').classList.add('show');
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
  }
};

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

// Init
document.addEventListener('DOMContentLoaded', () => app.init().catch(console.error));
