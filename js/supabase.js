/* ============================================
   SUPABASE DATA LAYER
   Handles all database operations
   ============================================ */

const SUPABASE_URL = 'https://itgyatshpvwxqmfhxgra.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0Z3lhdHNocHZ3eHFtZmh4Z3JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTU0MzMsImV4cCI6MjA5MTMzMTQzM30.tt3KNvdaccTVflvYSuHK2Fvq-ObAbYrFhF9LGV5RpUk';

const db = {
  // ---- HTTP helpers ----
  async _fetch(table, { method = 'GET', body, query = '', headers = {} } = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
    const h = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...headers
    };
    if (body) h['Content-Type'] = 'application/json';
    if (method === 'POST' && !h['Prefer']) h['Prefer'] = 'return=representation';
    if (method === 'PATCH') h['Prefer'] = 'return=representation';

    const opts = { method, headers: h };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const err = await res.text();
        console.error(`Supabase error [${method} ${table}]:`, err);
        return null;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      console.error(`Network error [${method} ${table}]:`, err);
      return null;
    }
  },

  // ---- PEOPLE ----
  async getPeople() {
    return await this._fetch('people', { query: '?order=first_name.asc' }) || [];
  },

  async upsertPerson(person) {
    // Map JS camelCase to DB snake_case
    const row = {
      id: person.id,
      first_name: person.firstName,
      last_name: person.lastName || '',
      phone: person.phone || '',
      email: person.email || '',
      status: person.status || 'new',
      stage: person.stage || 'attending',
      connector: person.connector || '',
      notes: person.notes || '',
      last_attended: person.lastAttended || null,
      needs_followup: person.needsFollowup || false,
      followup_done: person.followupDone || false,
      followup_assigned_to: person.followupAssignedTo || '',
      attendance_count: person.attendanceCount || 0
    };

    return await this._fetch('people', {
      method: 'POST',
      body: row,
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' }
    });
  },

  async deletePerson(id) {
    return await this._fetch('people', {
      method: 'DELETE',
      query: `?id=eq.${id}`
    });
  },

  async updatePerson(id, fields) {
    // Convert camelCase to snake_case
    const row = {};
    const map = {
      firstName: 'first_name', lastName: 'last_name', phone: 'phone', email: 'email',
      status: 'status', stage: 'stage', connector: 'connector', notes: 'notes',
      lastAttended: 'last_attended', needsFollowup: 'needs_followup',
      followupDone: 'followup_done', followupAssignedTo: 'followup_assigned_to',
      attendanceCount: 'attendance_count'
    };
    for (const [js, pg] of Object.entries(map)) {
      if (fields[js] !== undefined) row[pg] = fields[js];
    }
    return await this._fetch('people', {
      method: 'PATCH',
      query: `?id=eq.${id}`,
      body: row
    });
  },

  async bulkInsertPeople(people) {
    const rows = people.map(p => ({
      id: p.id,
      first_name: p.firstName,
      last_name: p.lastName || '',
      phone: p.phone || '',
      email: p.email || '',
      status: p.status || 'new',
      stage: p.stage || 'attending',
      connector: p.connector || '',
      notes: p.notes || '',
      needs_followup: p.needsFollowup || false,
      followup_done: false,
      attendance_count: 0
    }));
    return await this._fetch('people', {
      method: 'POST',
      body: rows,
      headers: { 'Prefer': 'return=representation' }
    });
  },

  // ---- ATTENDANCE ----
  async getAttendance() {
    return await this._fetch('attendance', { query: '?order=date.desc' }) || [];
  },

  async upsertAttendance(record) {
    return await this._fetch('attendance', {
      method: 'POST',
      body: {
        date: record.date,
        checked_in: record.checkedIn,
        total: record.total,
        new_people: record.newPeople || 0
      },
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' }
    });
  },

  // ---- TEAMS ----
  async getTeams() {
    return await this._fetch('teams', { query: '?order=id.asc' }) || [];
  },

  async getTeamMembers() {
    return await this._fetch('team_members', { query: '?order=name.asc' }) || [];
  },

  async addTeamMember(teamId, name, role) {
    return await this._fetch('team_members', {
      method: 'POST',
      body: { team_id: teamId, name, role: role || 'Member' }
    });
  },

  // ---- MICROGROUPS ----
  async getGroups() {
    return await this._fetch('microgroups', { query: '?order=created_at.desc' }) || [];
  },

  async createGroup(group) {
    return await this._fetch('microgroups', {
      method: 'POST',
      body: {
        id: group.id,
        name: group.name,
        type: group.type || 'mixed',
        leader: group.leader || '',
        day: group.day || '',
        location: group.location || '',
        description: group.description || ''
      }
    });
  },

  // ---- WEEKLY PREP ----
  async getCurrentWeeklyPrep() {
    const rows = await this._fetch('weekly_prep', { query: '?is_current=eq.true&limit=1' });
    return rows && rows.length > 0 ? rows[0] : null;
  },

  async upsertWeeklyPrep(prep) {
    // Archive old current
    if (!prep.id) {
      await this._fetch('weekly_prep', {
        method: 'PATCH',
        query: '?is_current=eq.true',
        body: { is_current: false }
      });
    }
    return await this._fetch('weekly_prep', {
      method: 'POST',
      body: {
        id: prep.id || undefined,
        topic: prep.topic || '',
        scripture: prep.scripture || '',
        takeaway: prep.takeaway || '',
        cta: prep.cta || '',
        icebreaker: prep.icebreaker || '',
        questions: prep.questions || [],
        is_current: true
      },
      headers: prep.id
        ? { 'Prefer': 'return=representation,resolution=merge-duplicates' }
        : { 'Prefer': 'return=representation' }
    });
  },

  async getPastWeeks() {
    return await this._fetch('weekly_prep', { query: '?is_current=eq.false&order=created_at.desc&limit=20' }) || [];
  },

  // ---- MESSAGES ----
  async getMessages() {
    return await this._fetch('messages', { query: '?order=created_at.desc' }) || [];
  },

  async createMessage(msg) {
    return await this._fetch('messages', {
      method: 'POST',
      body: msg
    });
  },

  // ---- TEAM USERS ----
  async getTeamUsers() {
    return await this._fetch('team_users') || [];
  },

  // ---- HELPERS ----
  // Convert DB row (snake_case) to JS object (camelCase)
  personFromRow(row) {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name || '',
      phone: row.phone || '',
      email: row.email || '',
      status: row.status || 'new',
      stage: row.stage || 'attending',
      connector: row.connector || '',
      notes: row.notes || '',
      lastAttended: row.last_attended || '',
      needsFollowup: row.needs_followup || false,
      followupDone: row.followup_done || false,
      followupAssignedTo: row.followup_assigned_to || '',
      attendanceCount: row.attendance_count || 0,
      createdAt: row.created_at
    };
  },

  attendanceFromRow(row) {
    return {
      date: row.date,
      checkedIn: row.checked_in || [],
      total: row.total || 0,
      newPeople: row.new_people || 0
    };
  }
};
