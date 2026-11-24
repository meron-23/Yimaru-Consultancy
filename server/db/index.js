import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { syncLeadToYimaruCrm } from '../crm/yimaruCrmSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data store path for local persistent store
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const SEED_PATH = path.join(__dirname, '..', '..', 'supabase', 'seed.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize Supabase client if environment variables are provided
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const isTestMode = Boolean(process.argv[1]?.includes('test') || process.env.IS_TEST);

if (supabaseUrl && supabaseKey && !isTestMode) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    console.log('[DB] Connected to Supabase at:', supabaseUrl);
  } catch (err) {
    console.error('[DB] Failed to initialize Supabase client:', err.message);
  }
} else if (isTestMode) {
  console.log('[DB] Operating in isolated test store mode.');
} else {
  console.log('[DB] No Supabase credentials configured. Operating in high-fidelity local persistent store mode.');
}

/**
 * Load local database store
 */
function loadLocalStore() {
  if (fs.existsSync(STORE_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (!data.chat_logs) data.chat_logs = [];
      if (!data.ai_notes) data.ai_notes = [];
      return data;
    } catch (e) {
      console.error('[DB] Error reading store.json, reinitializing from seed:', e.message);
    }
  }

  // Fallback to seed.json
  if (fs.existsSync(SEED_PATH)) {
    try {
      const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
      const initialStore = {
        countries: seed.countries || [],
        scholarships: seed.scholarships || [],
        site_content: seed.site_content || [],
        leads: [],
        chat_logs: [],
        ai_notes: [],
        content_documents: [],
        audit_logs: [],
        admins: [
          {
            id: 'admin-1',
            email: process.env.ADMIN_EMAIL || 'admin@yimaru.com',
            // Default hash for 'AdminYimaru2026!'
            password_hash: '$2a$10$Z5qgoECGyHQH0XycvZSl7eiFhjdnt.Nvu5vsFwPyjVugGutXkXf46',
            name: 'Yimaru Admin',
            role: 'super_admin',
            created_at: new Date().toISOString()
          }
        ]
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(initialStore, null, 2), 'utf8');
      return initialStore;
    } catch (e) {
      console.error('[DB] Error loading seed:', e.message);
    }
  }

  return {
    countries: [],
    scholarships: [],
    site_content: [],
    leads: [],
    content_documents: [],
    audit_logs: [],
    admins: []
  };
}

/**
 * Save local database store
 */
function saveLocalStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export const db = {
  isSupabaseConfigured() {
    return Boolean(supabase);
  },

  getSupabaseClient() {
    return supabase;
  },

  // ---------------- COUNTRIES ----------------

  async getCountries({ status, region, search, publishedOnly = false } = {}) {
    if (supabase) {
      try {
        let query = supabase.from('countries').select('*').order('sort', { ascending: true });
        if (publishedOnly) {
          query = query.eq('published', true);
        } else if (status && status !== 'all') {
          query = query.eq('status', status);
        }
        const { data, error } = await query;
        if (!error && data) {
          let filtered = data;
          if (region && region !== 'all') {
            filtered = filtered.filter(c => c.data?.reg === region);
          }
          if (search) {
            const q = search.toLowerCase();
            filtered = filtered.filter(c => {
              const nameStr = Array.isArray(c.data?.name) ? c.data.name.join(' ') : (c.data?.name || '');
              return c.id.toLowerCase().includes(q) || nameStr.toLowerCase().includes(q);
            });
          }
          return filtered;
        }
      } catch (err) {
        console.warn('[DB] Supabase getCountries failed, falling back to local store:', err.message);
      }
    }

    const store = loadLocalStore();
    let list = store.countries;
    if (publishedOnly) {
      list = list.filter(c => c.status === 'published' || c.published === true);
    } else if (status && status !== 'all') {
      list = list.filter(c => c.status === status);
    }
    if (region && region !== 'all') {
      list = list.filter(c => c.data?.reg === region);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => {
        const nameStr = Array.isArray(c.data?.name) ? c.data.name.join(' ') : (c.data?.name || '');
        return c.id.toLowerCase().includes(q) || nameStr.toLowerCase().includes(q);
      });
    }
    return list.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  },

  async getCountry(id) {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('countries').select('*').eq('id', id).maybeSingle();
        if (!error && data) return data;
      } catch (err) {
        console.warn('[DB] Supabase getCountry failed, falling back:', err.message);
      }
    }

    const store = loadLocalStore();
    return store.countries.find(c => c.id === id) || null;
  },

  async saveCountry(countryObj, { status = 'draft', featured = false, sort = null, source_url = '', source_metadata = {}, user_id = null } = {}) {
    const id = countryObj.id || countryObj.data?.id;
    if (!id) throw new Error('Country id is required');

    const now = new Date().toISOString();
    const store = loadLocalStore();
    const existingIndex = store.countries.findIndex(c => c.id === id);

    const calculatedSort = sort !== null 
      ? sort 
      : (existingIndex >= 0 ? store.countries[existingIndex].sort : store.countries.length + 1);

    const record = {
      id,
      data: countryObj.data ? countryObj.data : countryObj,
      featured: Boolean(featured),
      sort: calculatedSort,
      status: status,
      published: status === 'published',
      source_url: source_url || '',
      source_metadata: source_metadata || {},
      created_at: existingIndex >= 0 ? store.countries[existingIndex].created_at : now,
      updated_at: now,
      created_by: user_id
    };

    // Ensure data.id matches
    record.data.id = id;

    // Update local store
    if (existingIndex >= 0) {
      store.countries[existingIndex] = record;
    } else {
      store.countries.push(record);
    }
    saveLocalStore(store);

    // Sync with Supabase if configured
    if (supabase) {
      try {
        await supabase.from('countries').upsert({
          id: record.id,
          data: record.data,
          featured: record.featured,
          sort: record.sort,
          status: record.status,
          source_url: record.source_url,
          source_metadata: record.source_metadata,
          updated_at: now
        });
      } catch (err) {
        console.error('[DB] Supabase upsert country failed:', err.message);
      }
    }

    this.logAudit(user_id, existingIndex >= 0 ? 'update' : 'create', 'country', id, { status });
    return record;
  },

  async updateCountryStatus(id, newStatus, user_id = null) {
    const valid = ['processing', 'draft', 'needs_review', 'published', 'archived'];
    if (!valid.includes(newStatus)) throw new Error('Invalid status: ' + newStatus);

    const store = loadLocalStore();
    const country = store.countries.find(c => c.id === id);
    if (!country) throw new Error('Country not found: ' + id);

    country.status = newStatus;
    country.published = newStatus === 'published';
    country.updated_at = new Date().toISOString();
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('countries').update({
          status: newStatus,
          updated_at: country.updated_at
        }).eq('id', id);
      } catch (err) {
        console.error('[DB] Supabase update status failed:', err.message);
      }
    }

    this.logAudit(user_id, 'status_change', 'country', id, { newStatus });
    return country;
  },

  async deleteCountry(id, user_id = null) {
    const store = loadLocalStore();
    store.countries = store.countries.filter(c => c.id !== id);
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('countries').delete().eq('id', id);
      } catch (err) {
        console.error('[DB] Supabase delete country failed:', err.message);
      }
    }

    this.logAudit(user_id, 'delete', 'country', id, {});
    return true;
  },

  // ---------------- SCHOLARSHIPS ----------------

  async getScholarships({ status, level, coverage, search, publishedOnly = false } = {}) {
    if (supabase) {
      try {
        let query = supabase.from('scholarships').select('*').order('sort', { ascending: true });
        if (publishedOnly) {
          query = query.eq('published', true);
        } else if (status && status !== 'all') {
          query = query.eq('status', status);
        }
        const { data, error } = await query;
        if (!error && data) {
          let filtered = data;
          if (level && level !== 'all') {
            filtered = filtered.filter(s => Array.isArray(s.data?.lv) && s.data.lv.includes(level));
          }
          if (coverage && coverage !== 'all') {
            filtered = filtered.filter(s => s.data?.cov === coverage);
          }
          if (search) {
            const q = search.toLowerCase();
            filtered = filtered.filter(s => {
              const nameStr = s.data?.name || s.id;
              return s.id.toLowerCase().includes(q) || nameStr.toLowerCase().includes(q);
            });
          }
          return filtered;
        }
      } catch (err) {
        console.warn('[DB] Supabase getScholarships failed, falling back:', err.message);
      }
    }

    const store = loadLocalStore();
    let list = store.scholarships;
    if (publishedOnly) {
      list = list.filter(s => s.status === 'published' || s.published === true);
    } else if (status && status !== 'all') {
      list = list.filter(s => s.status === status);
    }
    if (level && level !== 'all') {
      list = list.filter(s => Array.isArray(s.data?.lv) && s.data.lv.includes(level));
    }
    if (coverage && coverage !== 'all') {
      list = list.filter(s => s.data?.cov === coverage);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => {
        const nameStr = s.data?.name || s.id;
        return s.id.toLowerCase().includes(q) || nameStr.toLowerCase().includes(q);
      });
    }
    return list.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  },

  async getScholarship(id) {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('scholarships').select('*').eq('id', id).maybeSingle();
        if (!error && data) return data;
      } catch (err) {
        console.warn('[DB] Supabase getScholarship failed, falling back:', err.message);
      }
    }

    const store = loadLocalStore();
    return store.scholarships.find(s => s.id === id) || null;
  },

  async saveScholarship(scholarshipObj, { status = 'draft', featured = false, sort = null, source_url = '', source_metadata = {}, user_id = null } = {}) {
    const id = scholarshipObj.id || scholarshipObj.data?.id;
    if (!id) throw new Error('Scholarship id is required');

    const now = new Date().toISOString();
    const store = loadLocalStore();
    const existingIndex = store.scholarships.findIndex(s => s.id === id);

    const calculatedSort = sort !== null 
      ? sort 
      : (existingIndex >= 0 ? store.scholarships[existingIndex].sort : store.scholarships.length + 1);

    const record = {
      id,
      data: scholarshipObj.data ? scholarshipObj.data : scholarshipObj,
      featured: Boolean(featured),
      sort: calculatedSort,
      status: status,
      published: status === 'published',
      source_url: source_url || '',
      source_metadata: source_metadata || {},
      created_at: existingIndex >= 0 ? store.scholarships[existingIndex].created_at : now,
      updated_at: now,
      created_by: user_id
    };

    record.data.id = id;

    if (existingIndex >= 0) {
      store.scholarships[existingIndex] = record;
    } else {
      store.scholarships.push(record);
    }
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('scholarships').upsert({
          id: record.id,
          data: record.data,
          featured: record.featured,
          sort: record.sort,
          status: record.status,
          source_url: record.source_url,
          source_metadata: record.source_metadata,
          updated_at: now
        });
      } catch (err) {
        console.error('[DB] Supabase upsert scholarship failed:', err.message);
      }
    }

    this.logAudit(user_id, existingIndex >= 0 ? 'update' : 'create', 'scholarship', id, { status });
    return record;
  },

  async updateScholarshipStatus(id, newStatus, user_id = null) {
    const valid = ['processing', 'draft', 'needs_review', 'published', 'archived'];
    if (!valid.includes(newStatus)) throw new Error('Invalid status: ' + newStatus);

    const store = loadLocalStore();
    const scholarship = store.scholarships.find(s => s.id === id);
    if (!scholarship) throw new Error('Scholarship not found: ' + id);

    scholarship.status = newStatus;
    scholarship.published = newStatus === 'published';
    scholarship.updated_at = new Date().toISOString();
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('scholarships').update({
          status: newStatus,
          updated_at: scholarship.updated_at
        }).eq('id', id);
      } catch (err) {
        console.error('[DB] Supabase update scholarship status failed:', err.message);
      }
    }

    this.logAudit(user_id, 'status_change', 'scholarship', id, { newStatus });
    return scholarship;
  },

  async deleteScholarship(id, user_id = null) {
    const store = loadLocalStore();
    store.scholarships = store.scholarships.filter(s => s.id !== id);
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('scholarships').delete().eq('id', id);
      } catch (err) {
        console.error('[DB] Supabase delete scholarship failed:', err.message);
      }
    }

    this.logAudit(user_id, 'delete', 'scholarship', id, {});
    return true;
  },

  // ---------------- SITE CONTENT ----------------

  async getSiteContent() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('site_content').select('key,value');
        if (!error && data) return data;
      } catch (err) {
        console.warn('[DB] Supabase getSiteContent failed, falling back:', err.message);
      }
    }

    const store = loadLocalStore();
    return store.site_content || [];
  },

  async saveSiteContent(key, value, user_id = null) {
    const store = loadLocalStore();
    const idx = store.site_content.findIndex(c => c.key === key);
    if (idx >= 0) {
      store.site_content[idx].value = value;
      store.site_content[idx].updated_at = new Date().toISOString();
    } else {
      store.site_content.push({ key, value, updated_at: new Date().toISOString() });
    }
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('site_content').upsert({
          key,
          value,
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('[DB] Supabase saveSiteContent failed:', err.message);
      }
    }

    this.logAudit(user_id, 'update', 'site_content', key, {});
    return { key, value };
  },

  // ---------------- LEADS ----------------

  async getLeads({ search, status } = {}) {
    if (supabase) {
      try {
        let query = supabase.from('leads').select('*').order('created_at', { ascending: false });
        if (status && status !== 'all') query = query.eq('status', status);
        const { data, error } = await query;
        if (!error && data) {
          if (search) {
            const q = search.toLowerCase();
            return data.filter(l => 
              (l.name && l.name.toLowerCase().includes(q)) ||
              (l.email && l.email.toLowerCase().includes(q)) ||
              (l.phone && l.phone.toLowerCase().includes(q))
            );
          }
          return data;
        }
      } catch (err) {
        console.warn('[DB] Supabase getLeads failed, falling back:', err.message);
      }
    }

    const store = loadLocalStore();
    let leads = store.leads || [];
    if (status && status !== 'all') {
      leads = leads.filter(l => l.status === status);
    }
    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(l => 
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q))
      );
    }
    return leads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async saveLead(leadData) {
    const lead = {
      id: leadData.id || 'lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      name: leadData.name || leadData.fname || '',
      email: leadData.email || null,
      phone: leadData.phone || '',
      city: leadData.city || null,
      pref: leadData.pref || leadData.contact_pref || 'tg',
      language: leadData.language || 'en',
      level: leadData.level || leadData.edu_level || leadData.edu || null,
      want: leadData.want || null,
      field: leadData.field || null,
      intake: leadData.intake || leadData.when || null,
      countries: leadData.countries || leadData.destinations || [],
      scholarship: leadData.scholarship || leadData.scholarship_id || null,
      answers: leadData.answers || leadData,
      result: leadData.result || [],
      summary: leadData.summary || '',
      consent: Boolean(leadData.consent),
      source: leadData.source || 'website',
      status: 'new',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const store = loadLocalStore();
    store.leads.unshift(lead);
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('leads').insert(lead);
      } catch (err) {
        console.error('[DB] Supabase saveLead failed:', err.message);
      }
    }

    // Automatically synchronize new lead to Yimaru CRM
    try {
      const crmRes = await syncLeadToYimaruCrm(lead);
      if (crmRes && crmRes.success && crmRes.caseId) {
        lead.crm_case_id = crmRes.caseId;
        saveLocalStore(store);
      }
    } catch (crmErr) {
      console.warn('[CRM-SYNC] Automatic sync failed:', crmErr.message);
    }

    return lead;
  },

  // ---------------- CONTENT DOCUMENTS & AUDIT ----------------

  async saveDocument(doc) {
    const record = {
      id: doc.id || 'doc-' + Date.now(),
      filename: doc.filename,
      file_type: doc.file_type,
      file_size: doc.file_size || 0,
      storage_path: doc.storage_path || null,
      raw_text: doc.raw_text || '',
      content_type: doc.content_type || 'unknown',
      detected_target_id: doc.detected_target_id || null,
      extraction_result: doc.extraction_result || null,
      missing_fields: doc.missing_fields || [],
      status: doc.status || 'uploaded',
      error_message: doc.error_message || null,
      created_at: new Date().toISOString(),
      created_by: doc.user_id || null
    };

    const store = loadLocalStore();
    store.content_documents.unshift(record);
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('content_documents').insert(record);
      } catch (err) {
        console.error('[DB] Supabase saveDocument failed:', err.message);
      }
    }

    return record;
  },

  async getDocuments() {
    const store = loadLocalStore();
    return store.content_documents || [];
  },

  async logAudit(user_id, action, entity_type, entity_id, changes = {}) {
    const record = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      user_id,
      action,
      entity_type,
      entity_id,
      changes,
      created_at: new Date().toISOString()
    };

    const store = loadLocalStore();
    store.audit_logs.unshift(record);
    // Keep max 500 audit logs
    if (store.audit_logs.length > 500) store.audit_logs.pop();
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('audit_logs').insert(record);
      } catch (err) {
        // quiet ignore
      }
    }
  },

  // ---------------- STATS ----------------

  async getStats() {
    const countries = await this.getCountries();
    const scholarships = await this.getScholarships();
    const leads = await this.getLeads();

    const countryStats = {
      total: countries.length,
      published: countries.filter(c => c.status === 'published').length,
      draft: countries.filter(c => c.status === 'draft').length,
      needs_review: countries.filter(c => c.status === 'needs_review').length,
      archived: countries.filter(c => c.status === 'archived').length
    };

    const scholarshipStats = {
      total: scholarships.length,
      published: scholarships.filter(s => s.status === 'published').length,
      draft: scholarships.filter(s => s.status === 'draft').length,
      needs_review: scholarships.filter(s => s.status === 'needs_review').length,
      archived: scholarships.filter(s => s.status === 'archived').length
    };

    const leadStats = {
      total: leads.length,
      new: leads.filter(l => l.status === 'new').length,
      unsynced: leads.filter(l => !l.crm_case_id).length
    };

    const chatLogs = await this.getChatLogs({ limit: 1000 });
    const aiNotes = await this.getAiNotes();

    const chatStats = {
      total: chatLogs.length,
      flagged: chatLogs.filter(c => c.flagged).length,
      unreviewed: chatLogs.filter(c => !c.reviewed).length
    };

    const noteStats = {
      total: aiNotes.length,
      active: aiNotes.filter(n => n.active).length
    };

    return {
      countries: countryStats,
      scholarships: scholarshipStats,
      leads: leadStats,
      chat: chatStats,
      notes: noteStats,
      isSupabaseConnected: Boolean(supabase)
    };
  },

  // ---------------- ADMIN USERS ----------------

  async getAdminByEmail(email) {
    const store = loadLocalStore();
    return store.admins.find(a => a.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async createAdmin(email, passwordHash, name = 'Admin') {
    const store = loadLocalStore();
    const existing = store.admins.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (existing) throw new Error('Admin with this email already exists');

    const admin = {
      id: 'admin-' + Date.now(),
      email,
      password_hash: passwordHash,
      name,
      role: 'admin',
      created_at: new Date().toISOString()
    };

    store.admins.push(admin);
    saveLocalStore(store);
    return admin;
  },

  // ---------------- CHAT LOGS ----------------

  async saveChatLog(logData) {
    const record = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      created_at: new Date().toISOString(),
      session: logData.session || 'unknown',
      lang: logData.lang || 'en',
      question: logData.question || '',
      answer: logData.answer || '',
      model: logData.model || 'gemini-flash-latest',
      status: logData.status || 'ok',
      handoff: Boolean(logData.handoff),
      flagged: Boolean(logData.flagged),
      flag_note: logData.flag_note || null,
      reviewed: Boolean(logData.reviewed),
      reviewed_by: logData.reviewed_by || null,
      page: logData.page || '/'
    };

    const store = loadLocalStore();
    store.chat_logs.unshift(record);
    if (store.chat_logs.length > 2000) store.chat_logs.pop();
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('chat_logs').insert(record);
      } catch (err) {
        // Quiet fallback
      }
    }
    return record;
  },

  async getChatLogs({ session, lang, flagged, reviewed, limit = 100, offset = 0 } = {}) {
    if (supabase) {
      try {
        let query = supabase.from('chat_logs').select('*').order('created_at', { ascending: false });
        if (session) query = query.eq('session', session);
        if (lang) query = query.eq('lang', lang);
        if (typeof flagged === 'boolean') query = query.eq('flagged', flagged);
        if (typeof reviewed === 'boolean') query = query.eq('reviewed', reviewed);
        query = query.range(offset, offset + limit - 1);
        const { data, error } = await query;
        if (!error && data) return data;
      } catch (err) {
        // Fallback to local store
      }
    }

    const store = loadLocalStore();
    let logs = [...store.chat_logs];
    if (session) logs = logs.filter(l => l.session === session);
    if (lang) logs = logs.filter(l => l.lang === lang);
    if (typeof flagged === 'boolean') logs = logs.filter(l => l.flagged === flagged);
    if (typeof reviewed === 'boolean') logs = logs.filter(l => l.reviewed === reviewed);
    return logs.slice(offset, offset + limit);
  },

  async updateChatLog(id, updates) {
    const numId = Number(id);
    const store = loadLocalStore();
    const idx = store.chat_logs.findIndex(l => l.id === numId || l.id === id);
    if (idx === -1) throw new Error('Chat log not found');

    const updated = {
      ...store.chat_logs[idx],
      ...updates,
      updated_at: new Date().toISOString()
    };
    store.chat_logs[idx] = updated;
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('chat_logs').update(updates).eq('id', id);
      } catch (err) {
        // Quiet fallback
      }
    }
    return updated;
  },

  // ---------------- AI KNOWLEDGE NOTES ----------------

  async getAiNotes({ activeOnly = false } = {}) {
    if (supabase) {
      try {
        let query = supabase.from('ai_notes').select('*').order('id', { ascending: true });
        if (activeOnly) query = query.eq('active', true);
        const { data, error } = await query;
        if (!error && data) return data;
      } catch (err) {
        // Fallback
      }
    }

    const store = loadLocalStore();
    let notes = [...store.ai_notes];
    if (activeOnly) notes = notes.filter(n => n.active);
    return notes;
  },

  async getAiNoteById(id) {
    const numId = Number(id);
    const store = loadLocalStore();
    return store.ai_notes.find(n => n.id === numId || n.id === id) || null;
  },

  async saveAiNote({ title, body, active = true, source = 'Advisor' }) {
    const store = loadLocalStore();
    const nextId = store.ai_notes.length ? Math.max(...store.ai_notes.map(n => Number(n.id) || 0)) + 1 : 1;
    const note = {
      id: nextId,
      title: title.trim(),
      body: body.trim(),
      active: Boolean(active),
      source: source || 'Advisor',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    store.ai_notes.push(note);
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('ai_notes').insert(note);
      } catch (err) {
        // Quiet fallback
      }
    }
    return note;
  },

  async updateAiNote(id, updates) {
    const numId = Number(id);
    const store = loadLocalStore();
    const idx = store.ai_notes.findIndex(n => n.id === numId || n.id === id);
    if (idx === -1) throw new Error('AI note not found');

    const updated = {
      ...store.ai_notes[idx],
      ...updates,
      updated_at: new Date().toISOString()
    };
    store.ai_notes[idx] = updated;
    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('ai_notes').update(updates).eq('id', id);
      } catch (err) {
        // Quiet fallback
      }
    }
    return updated;
  },

  async deleteAiNote(id) {
    const numId = Number(id);
    const store = loadLocalStore();
    const initialLen = store.ai_notes.length;
    store.ai_notes = store.ai_notes.filter(n => n.id !== numId && n.id !== id);
    if (store.ai_notes.length === initialLen) throw new Error('AI note not found');

    saveLocalStore(store);

    if (supabase) {
      try {
        await supabase.from('ai_notes').delete().eq('id', id);
      } catch (err) {
        // Quiet fallback
      }
    }
    return { success: true };
  }
};
