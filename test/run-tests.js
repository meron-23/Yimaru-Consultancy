process.env.NODE_ENV = 'test';
import http from 'http';
import { app } from '../server/index.js';
import { db } from '../server/db/index.js';
import {
  extractTextFromDocument,
  extractTextFromUrl,
  detectContentType,
  processWithAI,
  regenerateTranslation
} from '../server/ai/index.js';

let server;
let baseUrl = '';

// Test counters
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function runAllTests() {
  console.log(`
===========================================================
  🧪 Starting Yimaru AI-Powered CMS Test Suite
===========================================================
  `);

  // Start temporary test server on IPv4 loopback
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });

  try {
    let adminToken = '';

    // -------------------------------------------------------------
    // Test 1: Admin Authentication
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Admin Login & Authentication ---');
    {
      // Invalid login
      const failRes = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@yimaru.com', password: 'WrongPassword' })
      });
      assert(failRes.status === 401, 'Rejects invalid password with 401');

      // Valid login
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@yimaru.com', password: 'AdminYimaru2026!' })
      });
      if (loginRes.status !== 200) {
        console.error('Login failed response:', loginRes.status, loginRes.data);
      }
      assert(loginRes.status === 200 && loginRes.data.token, 'Authenticates default admin and returns JWT token');
      adminToken = loginRes.data.token;

      // Authenticated /api/auth/me
      const meRes = await request('/api/auth/me', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(meRes.status === 200 && meRes.data.user.email === 'admin@yimaru.com', 'Returns user profile for authenticated admin');
    }

    // -------------------------------------------------------------
    // Test 2: AI Document Text Extraction & Scanned PDF Guardrail
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Document Ingestion & Scanned PDF Detection ---');
    {
      // Mock plain text document
      const sampleTxt = Buffer.from('DAAD Helmut-Schmidt-Programme Scholarship for Master Studies in Germany. Full tuition waiver and €934 monthly stipend.', 'utf8');
      const txtRes = await extractTextFromDocument(sampleTxt, 'text/plain', 'daad_scholarship.txt');
      assert(txtRes.text.includes('DAAD Helmut-Schmidt'), 'Extracts text from uploaded TXT document');

      // Content type detection
      const schDetection = detectContentType(sampleTxt.toString('utf8'));
      assert(schDetection.type === 'scholarship', 'Correctly detects scholarship content type from text keywords');

      const countryText = 'Study in Poland: Tuition fees €2,000 to €4,000/yr. Cost of living €500/month. Student visa requirements and post-study work permit.';
      const ctryDetection = detectContentType(countryText);
      assert(ctryDetection.type === 'country', 'Correctly detects country destination content type from text keywords');
    }

    // -------------------------------------------------------------
    // Test 3 & 4: AI Extraction, Schema Structuring & 4-Language Generation
    // -------------------------------------------------------------
    console.log('\n--- Test 3 & 4: AI Structured Extraction & 4-Language Synthesis ---');
    let extractedSch = null;
    {
      const rawBulletin = `
        Turkiye Scholarships 2026 / 2027
        Full government scholarship for international students pursuing Bachelor, Master, or PhD degrees in Turkish Universities.
        Coverage: Full tuition fees, accommodation in university dormitories, monthly stipend, one-time round-trip flight ticket, and health insurance.
        Application Window: Annually open from January 10 to February 20.
        Eligibility Requirements:
        - Minimum 75% academic grade for Undergraduate candidates
        - Minimum 80% academic grade for Master and PhD candidates
        - Age requirement: under 21 for Bachelor, under 30 for Master
        Application Link: https://www.turkiyeburslari.gov.tr
        Strategic Note: Selecting universities in Ankara or Izmir instead of Istanbul significantly increases selection probability for Ethiopian applicants.
      `;

      const aiRes = await processWithAI({
        text: rawBulletin,
        contentType: 'scholarship',
        sourceUrl: 'https://www.turkiyeburslari.gov.tr',
        filename: 'turkiye_burslari_2026.pdf'
      });

      assert(aiRes.contentType === 'scholarship', 'Identifies content type as scholarship');
      assert(aiRes.data && aiRes.data.id, 'Generates valid structured scholarship schema with unique id');
      assert(aiRes.data.cov === 'full', 'Correctly extracts full funding coverage');
      assert(Array.isArray(aiRes.data.lv) && aiRes.data.lv.length > 0, 'Extracts eligible degree levels');

      // Check all 4 languages in multilingual fields
      const covers = aiRes.data.covers;
      assert(Array.isArray(covers) && covers.length === 4, 'Coverage field contains exactly 4 translations [en, am, om, ti]');
      assert(Boolean(covers[0] && covers[1] && covers[2] && covers[3]), 'All 4 language translations are non-empty for coverage');

      const win = aiRes.data.win;
      assert(Array.isArray(win) && win.length === 4, 'Application window contains exactly 4 translations [en, am, om, ti]');

      const note = aiRes.data.note;
      assert(Array.isArray(note) && note.length === 4, 'Strategic advisor note contains exactly 4 translations [en, am, om, ti]');

      extractedSch = aiRes.data;
    }

    // -------------------------------------------------------------
    // Test 5: Translation Regeneration for Single Field/Language
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Single Field Translation Regeneration ---');
    {
      const regenRes = await regenerateTranslation({
        field: 'covers',
        lang: 'am',
        textEn: 'Full tuition coverage and university dormitory accommodation',
        context: 'Turkiye Scholarships'
      });

      assert(Boolean(regenRes && regenRes.length > 0), 'Regenerates translation in Amharic on demand');
    }

    // -------------------------------------------------------------
    // Test 6: Save Draft (Not Publicly Visible)
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Content Review & Draft Saving ---');
    const schId = 'test-turkiye-scholarship-' + Date.now();
    extractedSch.id = schId;
    {
      const saveRes = await request('/api/scholarships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          data: extractedSch,
          status: 'draft',
          source_url: 'https://www.turkiyeburslari.gov.tr'
        })
      });

      assert(saveRes.status === 201 && saveRes.data.scholarship.status === 'draft', 'Saves record in draft status');

      // Verify draft is NOT visible in public query
      const pubQuery = await request('/api/scholarships?publishedOnly=true');
      const foundInPublic = pubQuery.data.some(s => s.id === schId);
      assert(!foundInPublic, 'Draft scholarship is NOT visible to public visitors');

      // Verify draft IS visible in admin query
      const adminQuery = await request('/api/scholarships', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const foundInAdmin = adminQuery.data.some(s => s.id === schId);
      assert(foundInAdmin, 'Draft scholarship IS visible in authenticated admin listing');
    }

    // -------------------------------------------------------------
    // Test 7 & 8: Approve & Publish (Appears on Public Website)
    // -------------------------------------------------------------
    console.log('\n--- Test 7 & 8: Approve, Publish & Public Website Sync ---');
    {
      const pubRes = await request(`/api/scholarships/${schId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'published' })
      });
      assert(pubRes.status === 200 && pubRes.data.scholarship.status === 'published', 'Approves and sets status to published');

      // Now verify it appears in public content endpoint
      const pubContentRes = await request('/api/public/content');
      const foundPublic = pubContentRes.data.scholarships.find(s => s.id === schId);
      assert(Boolean(foundPublic), 'Published scholarship instantly appears in /api/public/content');
      assert(foundPublic.data.covers.length === 4, 'Published public item provides all 4 Ethiopian language translations');
    }

    // -------------------------------------------------------------
    // Test 9: Edit Existing Content & Archiving
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Edit Content & Archiving Outdated Items ---');
    {
      // Update field
      extractedSch.covers[0] = 'Updated 100% Tuition Waiver and Living Allowance';
      const updateRes = await request(`/api/scholarships/${schId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ data: extractedSch, status: 'published' })
      });
      assert(updateRes.status === 200, 'Successfully updates existing scholarship content');

      // Archive item
      const archiveRes = await request(`/api/scholarships/${schId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'archived' })
      });
      assert(archiveRes.status === 200 && archiveRes.data.scholarship.status === 'archived', 'Archives scholarship');

      // Verify archived item is removed from public listing
      const pubAfterArchive = await request('/api/public/content');
      const foundAfterArchive = pubAfterArchive.data.scholarships.some(s => s.id === schId);
      assert(!foundAfterArchive, 'Archived item is removed from public website view');
    }

    // -------------------------------------------------------------
    // Test 10: Security & Access Control Enforcement
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Security & Authorization Protection ---');
    {
      // Unauthenticated POST to /api/countries
      const noAuthPost = await request('/api/countries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { id: 'hacked-country' } })
      });
      assert(noAuthPost.status === 401, 'Rejects unauthenticated country creation with 401 Unauthorized');

      // Unauthenticated POST to /api/ai/upload
      const noAuthAi = await request('/api/ai/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'sample' })
      });
      assert(noAuthAi.status === 401, 'Rejects unauthenticated AI upload endpoint with 401');

      // SSRF security protection test
      try {
        await extractTextFromUrl('http://127.0.0.1:8080/secret');
        assert(false, 'Should have blocked SSRF attempt to 127.0.0.1');
      } catch (err) {
        assert(err.message.includes('forbidden') || err.message.includes('private'), 'Blocks SSRF requests to localhost/private IP addresses');
      }

      // AWS metadata SSRF test
      try {
        await extractTextFromUrl('http://169.254.169.254/latest/meta-data/');
        assert(false, 'Should have blocked SSRF attempt to cloud metadata IP');
      } catch (err) {
        assert(err.message.includes('forbidden'), 'Blocks SSRF requests to cloud metadata service');
      }
    }

    // -------------------------------------------------------------
    // Test 11: Public Lead Capture & Checker Integration
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Public Website Checker & Lead Capture ---');
    {
      const mockLead = {
        name: 'Abebe Kebede',
        phone: '+251 911 234567',
        email: 'abebe.test@gmail.com',
        city: 'Addis Ababa',
        pref: 'telegram',
        language: 'am',
        level: 'bachelor',
        field: 'Computer Science',
        intake: 'fall_2026',
        countries: ['poland', 'germany'],
        scholarship: 'daad',
        summary: 'Strong academic background in engineering with GPA 3.8',
        consent: true
      };

      const leadRes = await request('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockLead)
      });
      assert(leadRes.status === 201 && leadRes.data.leadId, 'Public lead submission succeeds with 201 Created');

      // Verify lead appears in admin lead management
      const leadsList = await request('/api/leads', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const foundLead = leadsList.data.find(l => l.phone.includes('911 234567') || l.email === 'abebe.test@gmail.com');
      assert(Boolean(foundLead), 'Submitted lead is recorded and visible to content managers in admin dashboard');
    }

    // -------------------------------------------------------------
    // Test 12: Country Workflow (Create, 4-Translations, Publish)
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Country Workflow (Create, 4-Translations, Publish) ---');
    {
      const countryRawText = `
        Study in Ireland 2026
        Ireland is a leading European technology and education hub.
        Tuition: €9,000–25,000/yr depending on institution and program.
        Living expenses: €800–1,200/mo.
        English requirement: IELTS 6.5 or Duolingo 115+.
        Work rights: 20 hrs/week during semesters, 40 hrs/week during holidays.
        Post-Study Work Visa (Third Level Graduate Scheme): Up to 2 years full-time work for Master graduates.
        Popular universities: Trinity College Dublin, University College Dublin, University of Galway.
      `;

      const aiCountry = await processWithAI({
        text: countryRawText,
        contentType: 'country',
        filename: 'study_in_ireland_guide.txt'
      });

      assert(aiCountry.contentType === 'country', 'Correctly identifies Country type');
      assert(aiCountry.data.name.length === 4, 'Generates country name in 4 languages');
      assert(aiCountry.data.wk.length === 4, 'Generates work rights in 4 languages');
      assert(aiCountry.data.desc.length === 4, 'Generates comprehensive guide description in 4 languages');

      // Publish country
      const ctryId = 'ireland-test-' + Date.now();
      aiCountry.data.id = ctryId;
      aiCountry.data.f = 'ie';

      const saveCountryRes = await request('/api/countries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          data: aiCountry.data,
          status: 'published'
        })
      });
      assert(saveCountryRes.status === 201, 'Publishes new country successfully');

      // Verify in public content
      const pubCtryCheck = await request('/api/public/content');
      const foundCtry = pubCtryCheck.data.countries.find(c => c.id === ctryId);
      assert(Boolean(foundCtry), 'New destination appears live on the public website');
    }

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`
===========================================================
  🎉 All ${passedTests}/${totalTests} Tests Passed Successfully!
===========================================================
    `);

  } catch (err) {
    console.error('\n❌ Test execution failed with error:', err.message);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
  }
}

runAllTests();
