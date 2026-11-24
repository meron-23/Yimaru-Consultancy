import express from 'express';
import multer from 'multer';
import { db } from '../db/index.js';
import { authenticateAdmin, requireAuth, signToken, hashPassword } from '../auth.js';
import {
  extractTextFromDocument,
  extractTextFromUrl,
  detectContentType,
  processWithAI,
  regenerateTranslation
} from '../ai/index.js';
import {
  handleChatRequest,
  handleExtractRequest,
  getKnowledgeText
} from '../ai/chatEngine.js';

const router = express.Router();

// Multer memory storage for safe file handling (PDF, DOCX, TXT up to 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/markdown'
    ];
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (allowed.includes(file.mimetype) || ['pdf', 'docx', 'doc', 'txt', 'md'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Please upload PDF, DOCX, or TXT documents.'));
    }
  }
});

// ==============================================================================
// 1. PUBLIC ENDPOINTS
// ==============================================================================

/**
 * Public configuration endpoint (safe client credentials only)
 */
router.get('/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    isSupabaseConfigured: db.isSupabaseConfigured(),
    hasAiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)
  });
});

/**
 * Public combined data endpoint for website rendering
 * ONLY returns published items!
 */
router.get('/public/content', async (req, res) => {
  try {
    const [countries, scholarships, siteContent] = await Promise.all([
      db.getCountries({ publishedOnly: true }),
      db.getScholarships({ publishedOnly: true }),
      db.getSiteContent()
    ]);

    res.json({
      countries: countries.map(c => ({ id: c.id, data: c.data, featured: c.featured, sort: c.sort })),
      scholarships: scholarships.map(s => ({ id: s.id, data: s.data, featured: s.featured, sort: s.sort })),
      site_content: siteContent
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch public content: ' + err.message });
  }
});

/**
 * Public endpoint to submit student lead from website checker
 */
router.post('/leads', async (req, res) => {
  try {
    const leadData = req.body;
    if (!leadData || (!leadData.phone && !leadData.email)) {
      return res.status(400).json({ error: 'Phone or email is required' });
    }

    const lead = await db.saveLead(leadData);
    res.status(201).json({ success: true, leadId: lead.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save lead: ' + err.message });
  }
});

// ==============================================================================
// 2. AUTHENTICATION ENDPOINTS
// ==============================================================================

/**
 * Admin Login
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { user, token } = await authenticateAdmin(email, password);
    res.json({
      success: true,
      user,
      token
    });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Authentication failed' });
  }
});

/**
 * Current authenticated admin
 */
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/**
 * Admin Logout
 */
router.post('/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// ==============================================================================
// 3. DASHBOARD & STATS
// ==============================================================================

/**
 * Admin dashboard statistics
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch statistics: ' + err.message });
  }
});

// ==============================================================================
// 4. COUNTRIES MANAGEMENT
// ==============================================================================

/**
 * List countries (Admin can view all statuses; optional filter)
 */
router.get('/countries', async (req, res) => {
  try {
    const { status, region, search, publishedOnly } = req.query;

    // Check if requester has admin token
    const authHeader = req.headers.authorization;
    const isPublic = !authHeader || publishedOnly === 'true';

    const countries = await db.getCountries({
      status,
      region,
      search,
      publishedOnly: isPublic
    });

    res.json(countries);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch countries: ' + err.message });
  }
});

/**
 * Get country by id
 */
router.get('/countries/:id', async (req, res) => {
  try {
    const country = await db.getCountry(req.params.id);
    if (!country) {
      return res.status(404).json({ error: 'Country not found' });
    }

    // If unauthenticated, ensure country is published
    if (!req.headers.authorization && country.status !== 'published') {
      return res.status(404).json({ error: 'Country not found' });
    }

    res.json(country);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch country: ' + err.message });
  }
});

/**
 * Create or save Country (Requires Auth)
 */
router.post('/countries', requireAuth, async (req, res) => {
  try {
    const { data, status = 'draft', featured = false, sort = null, source_url = '', source_metadata = {} } = req.body;

    if (!data || !data.id) {
      return res.status(400).json({ error: 'Country data with valid id is required' });
    }

    const saved = await db.saveCountry(data, {
      status,
      featured,
      sort,
      source_url,
      source_metadata,
      user_id: req.user.id
    });

    res.status(201).json({ success: true, country: saved });
  } catch (err) {
    res.status(400).json({ error: 'Failed to save country: ' + err.message });
  }
});

/**
 * Update Country (Requires Auth)
 */
router.put('/countries/:id', requireAuth, async (req, res) => {
  try {
    const { data, status, featured, sort, source_url, source_metadata } = req.body;
    const countryId = req.params.id;

    const countryObj = data ? { ...data, id: countryId } : { id: countryId };

    const saved = await db.saveCountry(countryObj, {
      status,
      featured,
      sort,
      source_url,
      source_metadata,
      user_id: req.user.id
    });

    res.json({ success: true, country: saved });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update country: ' + err.message });
  }
});

/**
 * Update Country Status (Requires Auth)
 */
router.patch('/countries/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updated = await db.updateCountryStatus(req.params.id, status, req.user.id);
    res.json({ success: true, country: updated });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update status: ' + err.message });
  }
});

/**
 * Delete Country (Requires Auth)
 */
router.delete('/countries/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteCountry(req.params.id, req.user.id);
    res.json({ success: true, message: 'Country deleted successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete country: ' + err.message });
  }
});

// ==============================================================================
// 5. SCHOLARSHIPS MANAGEMENT
// ==============================================================================

/**
 * List scholarships (Admin can view all statuses; optional filter)
 */
router.get('/scholarships', async (req, res) => {
  try {
    const { status, level, coverage, search, publishedOnly } = req.query;

    const authHeader = req.headers.authorization;
    const isPublic = !authHeader || publishedOnly === 'true';

    const scholarships = await db.getScholarships({
      status,
      level,
      coverage,
      search,
      publishedOnly: isPublic
    });

    res.json(scholarships);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scholarships: ' + err.message });
  }
});

/**
 * Get scholarship by id
 */
router.get('/scholarships/:id', async (req, res) => {
  try {
    const scholarship = await db.getScholarship(req.params.id);
    if (!scholarship) {
      return res.status(404).json({ error: 'Scholarship not found' });
    }

    if (!req.headers.authorization && scholarship.status !== 'published') {
      return res.status(404).json({ error: 'Scholarship not found' });
    }

    res.json(scholarship);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scholarship: ' + err.message });
  }
});

/**
 * Create or save Scholarship (Requires Auth)
 */
router.post('/scholarships', requireAuth, async (req, res) => {
  try {
    const { data, status = 'draft', featured = false, sort = null, source_url = '', source_metadata = {} } = req.body;

    if (!data || !data.id) {
      return res.status(400).json({ error: 'Scholarship data with valid id is required' });
    }

    const saved = await db.saveScholarship(data, {
      status,
      featured,
      sort,
      source_url,
      source_metadata,
      user_id: req.user.id
    });

    res.status(201).json({ success: true, scholarship: saved });
  } catch (err) {
    res.status(400).json({ error: 'Failed to save scholarship: ' + err.message });
  }
});

/**
 * Update Scholarship (Requires Auth)
 */
router.put('/scholarships/:id', requireAuth, async (req, res) => {
  try {
    const { data, status, featured, sort, source_url, source_metadata } = req.body;
    const schId = req.params.id;

    const schObj = data ? { ...data, id: schId } : { id: schId };

    const saved = await db.saveScholarship(schObj, {
      status,
      featured,
      sort,
      source_url,
      source_metadata,
      user_id: req.user.id
    });

    res.json({ success: true, scholarship: saved });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update scholarship: ' + err.message });
  }
});

/**
 * Update Scholarship Status (Requires Auth)
 */
router.patch('/scholarships/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updated = await db.updateScholarshipStatus(req.params.id, status, req.user.id);
    res.json({ success: true, scholarship: updated });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update status: ' + err.message });
  }
});

/**
 * Delete Scholarship (Requires Auth)
 */
router.delete('/scholarships/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteScholarship(req.params.id, req.user.id);
    res.json({ success: true, message: 'Scholarship deleted successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete scholarship: ' + err.message });
  }
});

// ==============================================================================
// 6. AI CONTENT INGESTION & EXTRACTION
// ==============================================================================

/**
 * Ingest document (file upload) or URL / Raw Text and run AI extraction
 */
router.post('/ai/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    let rawText = '';
    let sourceUrl = '';
    let filename = '';
    let contentType = req.body.contentType || 'auto'; // 'auto' | 'country' | 'scholarship'

    // 1. File Upload
    if (req.file) {
      filename = req.file.originalname;
      const extraction = await extractTextFromDocument(req.file.buffer, req.file.mimetype, filename);
      if (extraction.isScanned) {
        return res.status(422).json({
          error: extraction.error || 'Scanned PDF detected without OCR text layer.'
        });
      }
      rawText = extraction.text;
    }
    // 2. URL fetch
    else if (req.body.url) {
      sourceUrl = req.body.url.trim();
      const fetched = await extractTextFromUrl(sourceUrl);
      rawText = fetched.text;
    }
    // 3. Raw Text Paste
    else if (req.body.text) {
      rawText = req.body.text.trim();
      sourceUrl = req.body.sourceUrl || '';
    } else {
      return res.status(400).json({
        error: 'Please provide a file to upload, an official website URL, or source text.'
      });
    }

    if (!rawText || rawText.length < 20) {
      return res.status(422).json({
        error: 'Extracted content is too short or empty to perform structured analysis.'
      });
    }

    // Process with AI (Extract schema + 4 languages + missing fields check)
    const aiResult = await processWithAI({
      text: rawText,
      contentType,
      sourceUrl,
      filename
    });

    // Record document in audit/history
    await db.saveDocument({
      filename: filename || (sourceUrl ? new URL(sourceUrl).hostname : 'Text Input'),
      file_type: req.file ? req.file.mimetype : (sourceUrl ? 'url' : 'text'),
      file_size: req.file ? req.file.size : rawText.length,
      raw_text: rawText.slice(0, 5000), // store preview
      content_type: aiResult.contentType,
      detected_target_id: aiResult.data.id,
      extraction_result: aiResult.data,
      missing_fields: aiResult.missingFields,
      status: 'extracted',
      user_id: req.user.id
    });

    res.json({
      success: true,
      contentType: aiResult.contentType,
      data: aiResult.data,
      missingFields: aiResult.missingFields,
      sourceMetadata: aiResult.sourceMetadata
    });
  } catch (err) {
    console.error('[API] /ai/upload failed:', err.message);
    res.status(500).json({ error: 'AI Processing Error: ' + err.message });
  }
});

/**
 * Regenerate a single translation field in a specific language
 */
router.post('/ai/regenerate-translation', requireAuth, async (req, res) => {
  try {
    const { field, lang, textEn, context } = req.body;
    if (!lang || !textEn) {
      return res.status(400).json({ error: 'lang and textEn are required' });
    }

    const translation = await regenerateTranslation({ field, lang, textEn, context });
    res.json({ success: true, translation });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate translation: ' + err.message });
  }
});

// ==============================================================================
// 7. LEADS MANAGEMENT (ADMIN ONLY)
// ==============================================================================

router.get('/leads', requireAuth, async (req, res) => {
  try {
    const { search, status } = req.query;
    const leads = await db.getLeads({ search, status });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leads: ' + err.message });
  }
});

/**
 * Manually synchronize an existing lead to Yimaru CRM
 */
router.post('/leads/:id/sync-crm', requireAuth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const leads = await db.getLeads({});
    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { syncLeadToYimaruCrm } = await import('../crm/yimaruCrmSync.js');
    const syncRes = await syncLeadToYimaruCrm(lead);

    if (syncRes.success) {
      lead.crm_case_id = syncRes.caseId;
      res.json({ success: true, caseId: syncRes.caseId, message: `Synced to Yimaru CRM as case ${syncRes.caseId}` });
    } else {
      res.status(502).json({ error: syncRes.error || 'Failed to sync to Yimaru CRM' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// ==============================================================================
// 8. SITE CONTENT (FAQS, CONTACT SETTINGS)
// ==============================================================================

router.get('/site-content', async (req, res) => {
  try {
    const content = await db.getSiteContent();
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch site content: ' + err.message });
  }
});

router.put('/site-content/:key', requireAuth, async (req, res) => {
  try {
    const { value } = req.body;
    const updated = await db.saveSiteContent(req.params.key, value, req.user.id);
    res.json({ success: true, item: updated });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update site content: ' + err.message });
  }
});

// ==============================================================================
// 9. AI CHAT ASSISTANT & KNOWLEDGE
// ==============================================================================

/**
 * Public AI Chat endpoint
 */
router.post('/chat', async (req, res) => {
  try {
    const { lang, messages, profile, session, page } = req.body || {};
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const result = await handleChatRequest({
      ip,
      lang,
      messages,
      profile,
      session,
      page
    });

    if (result.error === 'busy') {
      return res.status(429).json({ error: 'busy' });
    }
    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.json({ reply: result.reply });
  } catch (err) {
    res.status(500).json({ error: 'Chat service error: ' + err.message });
  }
});

/**
 * AI Content Studio extraction endpoint (admin only)
 */
router.post('/extract', requireAuth, async (req, res) => {
  try {
    const { mode, text, url } = req.body || {};
    const result = await handleExtractRequest({ mode, text, url });
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Live knowledge preview: "What the AI reads" (admin only)
 */
router.get('/chat/knowledge-preview', requireAuth, async (req, res) => {
  try {
    const text = await getKnowledgeText(true);
    res.json({ knowledge: text, length: text.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Chat conversation logs (admin only)
 */
router.get('/chat/logs', requireAuth, async (req, res) => {
  try {
    const { lang, session, flagged, reviewed, limit, offset } = req.query;
    const logs = await db.getChatLogs({
      lang,
      session,
      flagged: flagged !== undefined ? flagged === 'true' : undefined,
      reviewed: reviewed !== undefined ? reviewed === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/chat/logs/:id', requireAuth, async (req, res) => {
  try {
    const updated = await db.updateChatLog(req.params.id, req.body);
    res.json({ success: true, log: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==============================================================================
// 10. AI KNOWLEDGE NOTES
// ==============================================================================

router.get('/ai/notes', requireAuth, async (req, res) => {
  try {
    const notes = await db.getAiNotes({ activeOnly: req.query.activeOnly === 'true' });
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ai/notes', requireAuth, async (req, res) => {
  try {
    const { title, body, active, source } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }
    const note = await db.saveAiNote({ title, body, active, source });
    res.status(201).json({ success: true, note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/ai/notes/:id', requireAuth, async (req, res) => {
  try {
    const updated = await db.updateAiNote(req.params.id, req.body);
    res.json({ success: true, note: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/ai/notes/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteAiNote(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

