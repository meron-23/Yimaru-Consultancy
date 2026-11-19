import https from 'https';

/**
 * Configuration for Yimaru CRM Firebase integration
 */
const CRM_CONFIG = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.CRM_FIREBASE_API_KEY || 'AIzaSyCCegjxUhxz8n-ahDmDmmMiM9mNDZTdd7Y',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.CRM_FIREBASE_PROJECT_ID || 'yimaru-crm',
  authEmail: process.env.CRM_SYNC_EMAIL || 'website-integration@yimaru.academy',
  authPassword: process.env.CRM_SYNC_PASSWORD || 'YimaruIntegration2026!'
};

// In-memory cache for auth token
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Standard country name normalizer matching Yimaru CRM's COUNTRIES list
 */
const CRM_COUNTRIES_MAP = {
  'germany': 'Germany',
  'de': 'Germany',
  'italy': 'Italy',
  'it': 'Italy',
  'hungary': 'Hungary',
  'hu': 'Hungary',
  'austria': 'Austria',
  'at': 'Austria',
  'cyprus': 'Cyprus',
  'cy': 'Cyprus',
  'poland': 'Poland',
  'pl': 'Poland',
  'czechia': 'Czech Republic',
  'czech republic': 'Czech Republic',
  'cz': 'Czech Republic',
  'france': 'France',
  'fr': 'France',
  'netherlands': 'Netherlands',
  'nl': 'Netherlands',
  'belgium': 'Belgium',
  'be': 'Belgium',
  'sweden': 'Sweden',
  'se': 'Sweden',
  'finland': 'Finland',
  'fi': 'Finland',
  'ireland': 'Ireland',
  'ie': 'Ireland',
  'uk': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'england': 'United Kingdom',
  'gb': 'United Kingdom',
  'usa': 'USA',
  'us': 'USA',
  'united states': 'USA',
  'united states of america': 'USA',
  'canada': 'Canada',
  'ca': 'Canada',
  'australia': 'Australia',
  'au': 'Australia',
  'new zealand': 'New Zealand',
  'nz': 'New Zealand',
  'china': 'China',
  'cn': 'China',
  'india': 'India',
  'in': 'India',
  'turkey': 'Turkey',
  'tr': 'Turkey',
  'türkiye': 'Turkey',
  'dubai': 'Dubai (UAE)',
  'uae': 'Dubai (UAE)',
  'russia': 'Russia',
  'ru': 'Russia',
  'south korea': 'South Korea',
  'korea': 'South Korea',
  'kr': 'South Korea',
  'japan': 'Japan',
  'jp': 'Japan',
  'rwanda': 'Rwanda'
};

function normalizeCountry(raw) {
  if (!raw) return '';
  const clean = String(raw).trim().toLowerCase();
  return CRM_COUNTRIES_MAP[clean] || (raw.charAt(0).toUpperCase() + raw.slice(1));
}

/**
 * HTTPS helper with JSON promise
 */
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, raw: data });
        } catch {
          resolve({ status: res.statusCode, data: {}, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('CRM request timed out after 10s'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Convert plain JS value into Firestore Document Value format
 */
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Convert plain JS object to Firestore Document format
 */
function toFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

/**
 * Authenticate with Firebase Auth and get ID Token
 */
async function getAuthToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const payload = {
    email: CRM_CONFIG.authEmail,
    password: CRM_CONFIG.authPassword,
    returnSecureToken: true
  };

  const res = await httpsRequest({
    hostname: 'identitytoolkit.googleapis.com',
    path: `/v1/accounts:signInWithPassword?key=${CRM_CONFIG.apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, payload);

  if (res.status !== 200 || !res.data.idToken) {
    throw new Error(`Firebase auth failed (${res.status}): ${res.data?.error?.message || res.raw}`);
  }

  cachedToken = res.data.idToken;
  const expiresIn = parseInt(res.data.expiresIn || '3600', 10);
  tokenExpiresAt = now + expiresIn * 1000;
  return cachedToken;
}

/**
 * Compute the next Case ID according to Yimaru CRM specification:
 * Format: YIM-<year>-<0001>
 */
async function getNextCaseId(token) {
  const year = new Date().getFullYear();
  const prefix = `YIM-${year}-`;
  let maxNum = 0;

  try {
    const res = await httpsRequest({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${CRM_CONFIG.projectId}/databases/(default)/documents/students`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 200 && Array.isArray(res.data.documents)) {
      res.data.documents.forEach((doc) => {
        const docName = doc.name || '';
        const id = docName.split('/').pop() || '';
        if (id.startsWith(prefix)) {
          const numStr = id.slice(prefix.length).replace(/[^0-9]/g, '');
          const n = parseInt(numStr, 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      });
    }
  } catch (err) {
    console.warn('[CRM-SYNC] Could not fetch existing student IDs, defaulting:', err.message);
  }

  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

/**
 * Transform a lead from Yimaru Consulting Website into a full Yimaru CRM Student record
 */
export function mapLeadToCrmStudent(lead, caseId) {
  const now = new Date().toISOString();
  const answers = lead.answers || {};

  // Normalize target countries
  const rawCountries = Array.isArray(lead.countries) ? lead.countries : (lead.countries ? [lead.countries] : []);
  const targetCountries = rawCountries.map(normalizeCountry).filter(Boolean);
  const primaryCountry = targetCountries[0] || (lead.result && lead.result[0] ? normalizeCountry(lead.result[0].split(' ')[0]) : '');

  // Determine funding / sponsorship type
  const isScholarship = Boolean(
    lead.scholarship ||
    (lead.answers && lead.answers.funding && /scholarship/i.test(lead.answers.funding)) ||
    (lead.summary && /scholarship/i.test(lead.summary))
  );
  const sponsorType = isScholarship ? 'scholarship' : 'self';

  // Format intake
  let intake = lead.intake || answers.intake || '';
  if (intake.toLowerCase() === 'soon') intake = 'Within 6 months';

  // Format education level
  let education = lead.level || answers.education || '';
  if (education === 'ba' || education === 'bachelor') education = "Bachelor's Degree";
  if (education === 'ma' || education === 'masters') education = "Master's Degree";

  // Build activity log note
  const noteId = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  const notes = [
    {
      id: noteId,
      ts: now,
      author: 'Website Lead Capture',
      text: `Lead generated from website study plan checker.\n` +
            `Preferred contact: ${lead.pref || 'phone'}\n` +
            `City: ${lead.city || 'N/A'}\n` +
            (lead.summary ? `\nAssessment Summary:\n${lead.summary}` : ''),
      kind: 'stage'
    }
  ];

  return {
    id: caseId,
    createdAt: now,
    updatedAt: now,
    fullName: (lead.name || 'Anonymous Student').trim(),
    phone: lead.phone || '',
    email: lead.email || '',
    source: 'Website',
    age: answers.age ? String(answers.age) : '',
    education: education,
    gpa: answers.gpa ? String(answers.gpa) : '',
    graduationYear: answers.graduationYear ? String(answers.graduationYear) : '',
    fieldOfStudy: lead.field || answers.field || '',
    englishProficiency: answers.english || '',
    workExperience: answers.work_exp || answers.workExperience || '',
    studyLevel: lead.want || '',
    targetCountries: targetCountries,
    budget: answers.funding || lead.scholarship || '',
    sponsor: answers.funding || '',
    sponsorRelationship: '',
    previousVisaHistory: answers.visa_history || '',
    previousRefusals: '',
    passportStatus: answers.passport || '',
    intendedIntake: intake,
    risk: '',
    sponsorType: sponsorType,
    packageType: '',
    payments: {
      registration: { paid: false, amount: '', date: '' },
      payment1: { paid: false, amount: '', date: '' },
      payment2: { paid: false, amount: '', date: '' }
    },
    assessmentNotes: lead.summary || '',
    strategy: {
      country: primaryCountry,
      university: '',
      program: '',
      admissionRoute: '',
      funding: sponsorType,
      visaRoute: ''
    },
    stage: 'lead',
    officer: 'Owner',
    archived: false,
    applications: [],
    financial: {},
    financialNotes: '',
    visaCountry: primaryCountry,
    visa: {},
    qcPassed: false,
    qcNotes: '',
    appointment: { requested: false, confirmed: false, biometrics: false, submitted: false, date: '' },
    interview: { mock1: false, difficult: false, mock2: false, ready: false },
    decision: '',
    notes: notes
  };
}

/**
 * Main Sync Function: Synchronizes a single website lead directly to Yimaru CRM (Firestore)
 */
export async function syncLeadToYimaruCrm(lead) {
  try {
    // During automated test suite runs, simulate successful sync without creating dummy records in live CRM
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_CRM_TEST_WRITE) {
      const mockCaseId = `YIM-${new Date().getFullYear()}-MOCK`;
      const studentData = mapLeadToCrmStudent(lead, mockCaseId);
      console.log(`[CRM-SYNC] (Test Mode) Simulated sync for: ${studentData.fullName} -> ${mockCaseId}`);
      return {
        success: true,
        caseId: mockCaseId,
        student: studentData
      };
    }

    // 1. Authenticate with Firebase
    const token = await getAuthToken();

    // 2. Generate next Case ID (e.g. YIM-2026-0002)
    const caseId = await getNextCaseId(token);

    // 3. Map lead to CRM schema
    const studentData = mapLeadToCrmStudent(lead, caseId);
    const firestorePayload = toFirestoreDoc(studentData);

    // 4. Save into Firestore `students` collection
    const writeRes = await httpsRequest({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${CRM_CONFIG.projectId}/databases/(default)/documents/students?documentId=${caseId}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, firestorePayload);

    if (writeRes.status !== 200) {
      console.error('[CRM-SYNC] Firestore write error:', writeRes.status, writeRes.data);
      return {
        success: false,
        error: `Firestore error (${writeRes.status}): ${writeRes.data?.error?.message || writeRes.raw}`
      };
    }

    console.log(`[CRM-SYNC] Successfully populated Yimaru CRM with new case: ${caseId} (${studentData.fullName})`);
    return {
      success: true,
      caseId: caseId,
      student: studentData
    };
  } catch (err) {
    console.error('[CRM-SYNC] Failed to synchronize lead to Yimaru CRM:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

export default {
  syncLeadToYimaruCrm,
  mapLeadToCrmStudent
};
