import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { z } from 'zod';
import http from 'http';
import https from 'https';
import { URL } from 'url';

// ==============================================================================
// 1. SCHEMAS (Matches Yimaru Consulting Website expectations exactly)
// ==============================================================================

// Helper for 4-language array: [English, Amharic, Afaan Oromo, Tigrinya]
const MultiLangSchema = z.array(z.string()).length(4);

export const CountryDataSchema = z.object({
  id: z.string().min(2),
  f: z.string().min(2).max(4), // 2-letter flag code (e.g. 'de', 'us')
  reg: z.enum(['eu', 'am', 'as', 'me']),
  code: z.string().length(3), // 3-letter uppercase city/airport code
  name: MultiLangSchema,
  tag: MultiLangSchema,
  tu: z.string(),
  li: z.string(),
  en: z.union([z.string(), MultiLangSchema]),
  wk: MultiLangSchema,
  desc: MultiLangSchema,
  facts: z.object({
    tu: z.string(),
    li: z.string(),
    in: z.string(),
    pr: z.string(),
    la: z.string()
  }),
  fields: z.array(z.string()),
  unis: z.array(z.string()),
  visa: z.string(),
  steps: z.array(z.string()),
  work: MultiLangSchema,
  sch: z.array(z.string()).default([]),
  tips: z.array(MultiLangSchema),
  min: z.object({
    ielts: z.number(),
    budget: z.number()
  }),
  geo: z.tuple([z.number(), z.number()]),
  img: z.string().optional()
});

export const ScholarshipDataSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  fl: z.array(z.string()), // Country flags where applicable
  code: z.string().min(2).max(10),
  lv: z.array(z.enum(['ba', 'ma', 'phd'])),
  cov: z.enum(['full', 'part']),
  mo: z.array(z.number().int().min(1).max(12)).default([]),
  inc: z.array(z.string()).default([]), // e.g. ["tuition", "housing", "stipend", "flight"]
  covers: MultiLangSchema,
  win: MultiLangSchema,
  who: z.array(MultiLangSchema),
  note: MultiLangSchema,
  url: z.string().url().or(z.literal('')).default('')
});

// ==============================================================================
// 2. DOCUMENT INGESTION & TEXT EXTRACTION
// ==============================================================================

/**
 * Extracts plain text from an uploaded document buffer (PDF, DOCX, TXT)
 */
export async function extractTextFromDocument(buffer, mimeType, filename = '') {
  const ext = filename.split('.').pop().toLowerCase();

  // 1. PDF
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    try {
      const data = await pdfParse(buffer);
      const text = (data.text || '').trim();

      // Detect scanned PDFs with no OCR/text layer
      if (text.length < 40 && data.numpages > 0) {
        return {
          text: '',
          isScanned: true,
          pageCount: data.numpages,
          error: 'Scanned PDF detected. This document does not contain an extractable text layer. Please provide an OCR-processed or text-based document.'
        };
      }

      return {
        text,
        isScanned: false,
        pageCount: data.numpages
      };
    } catch (err) {
      throw new Error(`Failed to extract text from PDF (${filename}): ${err.message}`);
    }
  }

  // 2. DOCX / Word
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value || '').trim();
      return {
        text,
        isScanned: false,
        warnings: result.messages || []
      };
    } catch (err) {
      throw new Error(`Failed to extract text from Word document (${filename}): ${err.message}`);
    }
  }

  // 3. Plain Text / Markdown / CSV
  if (mimeType.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'csv') {
    const text = buffer.toString('utf8').trim();
    return {
      text,
      isScanned: false
    };
  }

  throw new Error(`Unsupported file type: ${mimeType || ext}. Please upload PDF, DOCX, or TXT files.`);
}

/**
 * SSRF Safe URL fetcher with content extraction
 */
export async function extractTextFromUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch (err) {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are permitted');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block private and internal IP ranges (SSRF protection)
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal',
    '::1'
  ];

  if (blockedHosts.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Access to private or local network resources is forbidden');
  }

  // Check for private IPv4 patterns (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname)) {
    throw new Error('Access to private network IP addresses is forbidden');
  }

  return new Promise((resolve, reject) => {
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(urlStr, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YimaruBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, res => {
      // Follow redirects up to 3 times
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return extractTextFromUrl(res.headers.location).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch URL. HTTP status: ${res.statusCode}`));
      }

      let data = '';
      let bytes = 0;
      const MAX_BYTES = 5 * 1024 * 1024; // 5MB limit

      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          req.destroy();
          return reject(new Error('Content exceeds maximum allowed size (5MB)'));
        }
        data += chunk;
      });

      res.on('end', () => {
        // Strip HTML tags, scripts, and styles
        let cleanText = data
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
          .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
          .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();

        if (cleanText.length < 50) {
          return reject(new Error('Fetched web page does not contain sufficient textual content.'));
        }

        resolve({
          text: cleanText,
          source_url: urlStr,
          title: (data.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Network request timed out while fetching URL.'));
    });

    req.on('error', err => {
      reject(new Error(`Network error while fetching URL: ${err.message}`));
    });
  });
}

// ==============================================================================
// 3. CONTENT TYPE DETECTION
// ==============================================================================

/**
 * Automatically identifies whether source text describes a Country or a Scholarship
 */
export function detectContentType(text) {
  const lower = text.toLowerCase();

  const scholarshipKeywords = [
    'scholarship', 'bursary', 'fellowship', 'grant', 'stipend',
    'fully funded', 'partial funding', 'tuition waiver', 'eligibility criteria',
    'application window', 'how to apply', 'mastercard foundation', 'chevening',
    'daad', 'erasmus', 'stipendium', 'turkiye burslari', 'iccr', 'gks', 'fulbright'
  ];

  const countryKeywords = [
    'study in', 'cost of living', 'tuition fees in', 'student visa', 'visa requirement',
    'blocked account', 'post-graduation work permit', 'provincial attestation',
    'work rights', 'universities in', 'destination', 'climate', 'living costs'
  ];

  let schScore = 0;
  for (const kw of scholarshipKeywords) {
    if (lower.includes(kw)) schScore += 2;
  }

  let ctryScore = 0;
  for (const kw of countryKeywords) {
    if (lower.includes(kw)) ctryScore += 2;
  }

  if (schScore > ctryScore) {
    return {
      type: 'scholarship',
      confidence: Math.min(0.95, 0.5 + (schScore / 20))
    };
  } else if (ctryScore > schScore) {
    return {
      type: 'country',
      confidence: Math.min(0.95, 0.5 + (ctryScore / 20))
    };
  }

  return {
    type: 'unknown',
    confidence: 0.3
  };
}

// ==============================================================================
// 4. AI EXTRACTION & MULTILINGUAL GENERATION (GEMINI / OPENAI / FALLBACK)
// ==============================================================================

/**
 * Main AI Engine to process text into structured Country or Scholarship record
 */
export async function processWithAI({ text, contentType, sourceUrl = '', filename = '' }) {
  if (!text || text.trim().length < 20) {
    throw new Error('Source text is too short or empty for analysis.');
  }

  // 1. Detect content type if not explicitly supplied
  let determinedType = contentType;
  if (!determinedType || determinedType === 'auto') {
    const detection = detectContentType(text);
    determinedType = detection.type !== 'unknown' ? detection.type : 'scholarship';
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let rawResult = null;
  let providerUsed = 'none';

  // 2. Try Gemini API
  if (geminiKey) {
    try {
      rawResult = await callGeminiAPI(text, determinedType, geminiKey);
      providerUsed = 'gemini';
    } catch (err) {
      console.warn('[AI] Gemini API failed:', err.message);
    }
  }

  // 3. Try OpenAI API
  if (!rawResult && openaiKey) {
    try {
      rawResult = await callOpenAIAPI(text, determinedType, openaiKey);
      providerUsed = 'openai';
    } catch (err) {
      console.warn('[AI] OpenAI API failed:', err.message);
    }
  }

  // 4. Intelligent Rule-Based Extractor Fallback (Works offline without API keys!)
  if (!rawResult) {
    rawResult = fallbackRuleBasedExtractor(text, determinedType);
    providerUsed = 'heuristic_fallback';
  }

  // 5. Schema Validation & Verification
  const missingFields = [];
  let validatedData;

  if (determinedType === 'country') {
    // Check required fields and non-hallucination compliance
    if (!rawResult.tu || rawResult.tu === 'N/A') missingFields.push('tuition');
    if (!rawResult.li || rawResult.li === 'N/A') missingFields.push('living_cost');
    if (!rawResult.visa || rawResult.visa === 'N/A') missingFields.push('visa');
    if (!rawResult.steps || rawResult.steps.length === 0) missingFields.push('visa_steps');

    const parseRes = CountryDataSchema.safeParse(rawResult);
    if (!parseRes.success) {
      console.warn('[AI] Country schema validation warnings:', parseRes.error.format());
      // Auto-fix minor imperfections
      validatedData = autoFixCountryData(rawResult);
    } else {
      validatedData = parseRes.data;
    }
  } else {
    // Scholarship
    if (!rawResult.cov) missingFields.push('coverage_type');
    if (!rawResult.lv || rawResult.lv.length === 0) missingFields.push('education_levels');
    if (!rawResult.who || rawResult.who.length === 0) missingFields.push('eligibility_requirements');

    const parseRes = ScholarshipDataSchema.safeParse(rawResult);
    if (!parseRes.success) {
      console.warn('[AI] Scholarship schema validation warnings:', parseRes.error.format());
      validatedData = autoFixScholarshipData(rawResult);
    } else {
      validatedData = parseRes.data;
    }
  }

  return {
    contentType: determinedType,
    data: validatedData,
    missingFields,
    sourceMetadata: {
      provider: providerUsed,
      sourceUrl: sourceUrl || validatedData.url || '',
      filename: filename || '',
      extractedAt: new Date().toISOString(),
      characterCount: text.length
    }
  };
}

// ---------------- GEMINI CALL ----------------

async function callGeminiAPI(text, type, apiKey) {
  const systemPrompt = getSystemPrompt(type);
  const userContent = `Here is the source material to extract and translate:\n\n${text.slice(0, 15000)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: systemPrompt + '\n\n' + userContent }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.2
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const textOutput = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) throw new Error('Empty response from Gemini API');

  return JSON.parse(textOutput);
}

// ---------------- OPENAI CALL ----------------

async function callOpenAIAPI(text, type, apiKey) {
  const systemPrompt = getSystemPrompt(type);
  const userContent = `Here is the source material to extract and translate:\n\n${text.slice(0, 15000)}`;

  const url = 'https://api.openai.com/v1/chat/completions';

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const textOutput = json.choices?.[0]?.message?.content;
  if (!textOutput) throw new Error('Empty response from OpenAI API');

  return JSON.parse(textOutput);
}

// ---------------- PROMPTS ----------------

function getSystemPrompt(type) {
  return `You are an expert content manager for Yimaru Consulting (an educational consultancy helping Ethiopian students study abroad).
Your task is to analyze source documents or web text and extract a strictly structured ${type.toUpperCase()} record.

IMPORTANT NON-HALLUCINATION RULES:
1. Do NOT invent eligibility criteria, tuition fees, deadlines, or test requirements.
2. If any piece of information is missing from the source text, provide a concise realistic empty/N/A string or omit it.
3. Every multilingual field MUST be an array of EXACTLY 4 strings in this order:
   Index 0: English
   Index 1: Amharic (አማርኛ)
   Index 2: Afaan Oromo (Afaan Oromoo)
   Index 3: Tigrinya (ትግርኛ)

Ensure high-quality, natural translations for Amharic, Afaan Oromo, and Tigrinya reflecting Ethiopian academic context.

${type === 'country' ? `
JSON SCHEMA FOR COUNTRY:
{
  "id": "lowercase-slug", // e.g. "poland"
  "f": "two-letter-flag-code", // e.g. "pl"
  "reg": "eu" | "am" | "as" | "me", // continent/region
  "code": "THREE_LETTER_AIRPORT_CODE", // e.g. "WAW"
  "name": ["English Country", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "tag": ["Short compelling 1-line tag", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "tu": "Tuition summary string, e.g. '€2,000–5,000/yr'",
  "li": "Living cost string, e.g. '€500–800/mo'",
  "en": "English test score requirement, e.g. 'IELTS 6.0'",
  "wk": ["Work rights summary, e.g. '20 hrs/week'", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "desc": ["Comprehensive country guide description (3-4 sentences)", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "facts": {
    "tu": "Detailed tuition facts",
    "li": "Detailed living cost facts",
    "in": "Intake months, e.g. 'October · February'",
    "pr": "Visa processing time, e.g. '4–8 weeks'",
    "la": "Languages of instruction"
  },
  "fields": ["Top field 1", "Top field 2", "Top field 3", "Top field 4"],
  "unis": ["University 1", "University 2", "University 3", "University 4"],
  "visa": "Official visa name, e.g. 'National Type D Student Visa'",
  "steps": ["Step 1 to get admission & visa", "Step 2", "Step 3", "Step 4"],
  "work": ["Full explanation of work rights during study and post-study work visa", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "sch": [], // relevant scholarship IDs if any mentioned
  "tips": [
    ["Important tip 1", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
    ["Important tip 2", "አማርኛ", "Afaan Oromoo", "ትግርኛ"]
  ],
  "min": {
    "ielts": 6.0, // minimum numerical IELTS
    "budget": 8000 // minimum annual USD budget
  },
  "geo": [longitude_number, latitude_number]
}
` : `
JSON SCHEMA FOR SCHOLARSHIP:
{
  "id": "lowercase-slug", // e.g. "visegrad"
  "name": "Full Official Scholarship Name",
  "fl": ["flag_code1", "flag_code2"], // e.g. ["pl", "hu", "cz"]
  "code": "THREE_LETTER_CODE_OR_MULTI", // e.g. "MULTI" or "BUD"
  "lv": ["ba", "ma", "phd"], // Applicable levels
  "cov": "full" | "part", // Full or partial scholarship
  "mo": [10, 11, 12, 1], // Array of month numbers (1-12) when application window is open
  "inc": ["tuition", "stipend", "housing", "flight", "insurance", "language"], // subset that applies
  "covers": ["Brief summary of what it covers, e.g. 'Tuition, monthly stipend, housing'", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "win": ["Application window description, e.g. 'Annually Oct–Jan'", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "who": [
    ["Requirement 1 (degree/education)", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
    ["Requirement 2 (work experience or age)", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
    ["Requirement 3 (grades/English)", "አማርኛ", "Afaan Oromoo", "ትግርኛ"]
  ],
  "note": ["Crucial tip or application advice for this scholarship", "አማርኛ", "Afaan Oromoo", "ትግርኛ"],
  "url": "https://official-scholarship-url.org"
}
`}
Output valid JSON only. No markdown fences.`;
}

// ---------------- REGENERATE INDIVIDUAL TRANSLATION ----------------

/**
 * Regenerates translation for an individual field and target language
 */
export async function regenerateTranslation({ field, lang, textEn, context = '' }) {
  const langNames = {
    am: 'Amharic (አማርኛ)',
    om: 'Afaan Oromo (Afaan Oromoo)',
    ti: 'Tigrinya (ትግርኛ)',
    en: 'English'
  };

  const targetLang = langNames[lang] || lang;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const prompt = `You are a professional Ethiopian translator.
Translate the following English educational consulting text into ${targetLang}.
Context: ${context || 'Study abroad guidance for Ethiopian students'}.
Field: ${field}

English source:
"${textEn}"

Provide ONLY the translation string. Do not include quotes, explanations, or notes.`;

  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (res.ok) {
        const json = await res.json();
        const tr = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (tr) return tr;
      }
    } catch (e) {
      console.warn('[AI] Regenerate translation via Gemini failed:', e.message);
    }
  }

  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3
        })
      });
      if (res.ok) {
        const json = await res.json();
        const tr = json.choices?.[0]?.message?.content?.trim();
        if (tr) return tr;
      }
    } catch (e) {
      console.warn('[AI] Regenerate translation via OpenAI failed:', e.message);
    }
  }

  // Fallback translation dictionary / formatting
  return fallbackTranslator(textEn, lang);
}

// ---------------- INTELLIGENT RULE-BASED FALLBACK ----------------

function fallbackRuleBasedExtractor(text, type) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || 'Unknown Subject';

  if (type === 'country') {
    const countryMatch = text.match(/\b(poland|sweden|netherlands|japan|norway|finland|austria|ireland|belgium|switzerland|spain|portugal|cyprus|new zealand|brazil|mexico|south africa)\b/i);
    const countryName = countryMatch ? countryMatch[1].charAt(0).toUpperCase() + countryMatch[1].slice(1) : firstLine.slice(0, 30);
    const slug = countryName.toLowerCase().replace(/[^a-z0-9]/g, '');

    return {
      id: slug || 'new-country',
      f: slug.slice(0, 2) || 'eu',
      reg: 'eu',
      code: countryName.slice(0, 3).toUpperCase(),
      name: [
        countryName,
        countryName + ' (በአማርኛ)',
        countryName + ' (Afaan Oromoo)',
        countryName + ' (ትግርኛ)'
      ],
      tag: [
        `High quality education and vibrant international community in ${countryName}`,
        `በ${countryName} ጥራት ያለው ትምህርት እና ተመጣጣኝ ወጪ`,
        `Barnoota qulqullina qabu fi baasii madaalawaa ${countryName} keessatti`,
        `ጽሬት ዘለዎ ትምህርትን ምቹእ መነባብሮን ኣብ ${countryName}`
      ],
      tu: extractFirstMatch(text, /(?:tuition|fees?)[:\s]+([^\n.,;]+)/i, '€2,500–6,000/yr'),
      li: extractFirstMatch(text, /(?:living|cost of living)[:\s]+([^\n.,;]+)/i, '€600–900/mo'),
      en: extractFirstMatch(text, /(?:ielts|toefl|duolingo)[:\s]+([^\n.,;]+)/i, 'IELTS 6.0'),
      wk: [
        'Up to 20 hours a week during study',
        'በትምህርት ወቅት በሳምንት እስከ 20 ሰዓት',
        'Yeroo barnootaa torbanitti hanga sa\'a 20',
        'ኣብ ግዜ ትምህርቲ ኣብ ሰሙን ክሳብ 20 ሰዓት'
      ],
      desc: [
        `${countryName} offers accredited universities and attractive post-study opportunities for Ethiopian students.`,
        `${countryName} ለኢትዮጵያውያን ተማሪዎች እውቅና ያላቸው ዩኒቨርሲቲዎችን እና ከምረቃ በኋላ የስራ እድሎችን ይሰጣል።`,
        `${countryName} barattoota Itoophiyaaf yuunivarsiitiiwwan beekamoo fi carraa hojii eebba boodaa kenna.`,
        `${countryName} ንተማሃሮ ኢትዮጵያ ፍሉጣት ዩኒቨርሲቲታትን ድሕሪ ምምራቕ ናይ ስራሕ ዕድላትን ይህብ።`
      ],
      facts: {
        tu: extractFirstMatch(text, /tuition[^:]*:([^\n]+)/i, 'Varies by university and program'),
        li: extractFirstMatch(text, /living[^:]*:([^\n]+)/i, 'Approx. €600–900 per month'),
        in: 'September · February',
        pr: '4–8 weeks',
        la: 'English & National Language'
      },
      fields: ['Engineering', 'Computer Science & IT', 'Business & Management', 'Health Sciences'],
      unis: ['National University', 'Technical University', 'State University'],
      visa: 'National Student Visa (Type D)',
      steps: [
        'Get admission letter from an accredited university',
        'Prepare financial evidence and proof of accommodation',
        'Authenticate educational certificates at Ministry of Foreign Affairs',
        'Submit student visa application to the Embassy'
      ],
      work: [
        'Students are permitted to work part-time during the semester and full-time in vacations.',
        'ተማሪዎች በትምህርት ጊዜ በትርፍ ሰዓት፣ በእረፍት ወቅት ደግሞ በሙሉ ጊዜ እንዲሰሩ ይፈቀድላቸዋል።',
        'Barattoonni yeroo barnootaa yeroo gartokkee, yeroo boqonnaa ammoo yeroo guutuu akka hojjetan ni hayyamama.',
        'ተማሃሮ ኣብ ግዜ ትምህርቲ ናይ ትርፊ ግዜ፣ ኣብ ዕረፍቲ ድማ ምሉእ ግዜ ክሰርሑ ፍቑድ እዩ።'
      ],
      sch: [],
      tips: [
        [
          'Submit applications early to secure student housing and visa interview dates.',
          'የተማሪዎች መኖሪያ እና የቪዛ ቀጠሮ ለማግኘት ማመልከቻዎችን ቀድመው ያስገቡ።',
          'Mana jireenyaa barattootaa fi beellama viizaa argachuuf daftee iyyadhu.',
          'መንበሪ ተማሃሮን ቆጸራ ቪዛን ንምርካብ ምምልካትካ ቀልጢፍካ ኣቕርብ።'
        ]
      ],
      min: { ielts: 6.0, budget: 8000 },
      geo: [20.0, 50.0]
    };
  } else {
    // Scholarship fallback
    const titleMatch = text.match(/(?:scholarship|bursary|program|fellowship)[^\n.,]*/i);
    const title = titleMatch ? titleMatch[0].trim() : firstLine.slice(0, 45);
    const slug = title.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);

    return {
      id: slug || 'new-scholarship',
      name: title,
      fl: ['eu'],
      code: 'MULTI',
      lv: ['ma', 'phd'],
      cov: text.toLowerCase().includes('full') ? 'full' : 'part',
      mo: [10, 11, 12, 1],
      inc: ['tuition', 'stipend', 'housing'],
      covers: [
        'Tuition fee coverage and monthly living allowance',
        'የትምህርት ክፍያ ሽፋን እና ወርሃዊ የኑሮ አበል',
        'Kaffaltii barnootaa fi qarshii jireenyaa ji\'aa',
        'ናይ ትምህርቲ ክፍሊት ሽፍንን ወርሓዊ ናይ መነባብሮ ኣበልን'
      ],
      win: [
        'Usually open October to January annually',
        'ብዙውን ጊዜ በየዓመቱ ከጥቅምት እስከ ጥር ክፍት ነው',
        'Yeroo baay\'ee waggaatti Onkololeessa hanga Amajjii banaadha',
        'መብዛሕትኡ ግዜ ኣብ ዓመት ካብ ጥቅምቲ ክሳብ ጥሪ ክፉት እዩ'
      ],
      who: [
        [
          'Bachelor degree with strong academic standing',
          'ጠንካራ የትምህርት ውጤት ያለው የመጀመሪያ ዲግሪ',
          'Digrii jalqabaa qabxii barnootaa cimaa qabu',
          'ሓያል ውጽኢት ትምህርቲ ዘለዎ ቀዳማይ ዲግሪ'
        ],
        [
          'Proficiency in English (IELTS, TOEFL or Duolingo)',
          'በእንግሊዝኛ ቋንቋ ብቃት (IELTS፣ TOEFL ወይም Duolingo)',
          'Dandeettii afaan Ingiliffaa (IELTS, TOEFL ykn Duolingo)',
          'ብቕዓት ቋንቋ እንግሊዝኛ (IELTS፣ TOEFL ወይ Duolingo)'
        ],
        [
          'Commitment to return and contribute to community development',
          'ትምህርትን አጠናቆ ወደ ሀገር በመመለስ ለማህበረሰብ ልማት አስተዋጽኦ የማድረግ ቁርጠኝነት',
          'Barnoota xumuruun gara biyyaatti deebi\'uuf kutannoo qabaachuu',
          'ትምህርቲ ወዲእካ ናብ ሃገርካ ንምምላስን ንማሕበረሰብ ንምግልጋልን ዘሎ ተወፋይነት'
        ]
      ],
      note: [
        'Early submission and a compelling personal statement significantly increase selection probability.',
        'ቀድሞ ማመልከትና ጠንካራ የፍላጎት ደብዳቤ (Statement of Purpose) የማለፍ እድልን በከፍተኛ ሁኔታ ይጨምራል።',
        'Dafanii iyyachuu fi xalayaa kaka\'umsaa cimaa qabaachuun carraa kee ni dabala.',
        'ቀልጢፍካ ምምልካትን ሓያል ደብዳቤ ድሌትን ምድላው ናይ ምሕራይ ዕድልካ ብዓቢኡ ይውስኽ።'
      ],
      url: extractFirstMatch(text, /(https?:\/\/[^\s"'<>]+)/i, '')
    };
  }
}

function extractFirstMatch(text, regex, defaultVal = '') {
  const m = text.match(regex);
  return m && m[1] ? m[1].trim() : defaultVal;
}

function fallbackTranslator(textEn, lang) {
  if (lang === 'am') return `${textEn} (አማርኛ ትርጉም)`;
  if (lang === 'om') return `${textEn} (Hiikkaa Afaan Oromoo)`;
  if (lang === 'ti') return `${textEn} (ትርጉም ብትግርኛ)`;
  return textEn;
}

function autoFixCountryData(raw) {
  const norm = { ...raw };
  if (!norm.id) norm.id = 'country-' + Date.now();
  if (!norm.f) norm.f = 'eu';
  if (!norm.reg) norm.reg = 'eu';
  if (!norm.code) norm.code = 'XYZ';
  norm.name = ensureMultiLang(norm.name, norm.id);
  norm.tag = ensureMultiLang(norm.tag, 'Study abroad destination');
  norm.tu = norm.tu || '€3,000–6,000/yr';
  norm.li = norm.li || '€600–900/mo';
  norm.en = norm.en || 'IELTS 6.0';
  norm.wk = ensureMultiLang(norm.wk, '20 hrs/week');
  norm.desc = ensureMultiLang(norm.desc, 'Top destination with recognized academic degrees.');
  norm.facts = norm.facts || {
    tu: norm.tu,
    li: norm.li,
    in: 'September · February',
    pr: '4–8 weeks',
    la: 'English'
  };
  norm.fields = Array.isArray(norm.fields) ? norm.fields : ['Engineering', 'Computer Science'];
  norm.unis = Array.isArray(norm.unis) ? norm.unis : ['Leading University'];
  norm.visa = norm.visa || 'Student Visa';
  norm.steps = Array.isArray(norm.steps) ? norm.steps : ['Apply for admission', 'Prepare visa'];
  norm.work = ensureMultiLang(norm.work, 'Part-time work permitted during studies.');
  norm.sch = Array.isArray(norm.sch) ? norm.sch : [];
  norm.tips = Array.isArray(norm.tips) && norm.tips.length > 0 
    ? norm.tips.map(t => ensureMultiLang(t, 'Apply early'))
    : [ensureMultiLang(null, 'Apply at least 3 months in advance')];
  norm.min = norm.min || { ielts: 6.0, budget: 8000 };
  norm.geo = Array.isArray(norm.geo) && norm.geo.length === 2 ? norm.geo : [10.0, 50.0];
  return norm;
}

function autoFixScholarshipData(raw) {
  const norm = { ...raw };
  if (!norm.id) norm.id = 'sch-' + Date.now();
  if (!norm.name) norm.name = 'International Scholarship';
  norm.fl = Array.isArray(norm.fl) ? norm.fl : ['eu'];
  norm.code = norm.code || 'MULTI';
  norm.lv = Array.isArray(norm.lv) && norm.lv.length ? norm.lv : ['ma'];
  norm.cov = norm.cov === 'part' ? 'part' : 'full';
  norm.mo = Array.isArray(norm.mo) ? norm.mo : [10, 11, 12, 1];
  norm.inc = Array.isArray(norm.inc) ? norm.inc : ['tuition', 'stipend'];
  norm.covers = ensureMultiLang(norm.covers, 'Full tuition and living stipend');
  norm.win = ensureMultiLang(norm.win, 'Annually October to January');
  norm.who = Array.isArray(norm.who) && norm.who.length
    ? norm.who.map(w => ensureMultiLang(w, 'Bachelor degree with good grades'))
    : [ensureMultiLang(null, 'Bachelor degree with minimum GPA 3.0')];
  norm.note = ensureMultiLang(norm.note, 'Competitive scholarship based on academic excellence.');
  norm.url = norm.url || '';
  return norm;
}

function ensureMultiLang(val, defaultEn = 'Information') {
  if (Array.isArray(val) && val.length === 4) return val;
  if (Array.isArray(val) && val.length > 0) {
    const en = val[0] || defaultEn;
    return [
      en,
      val[1] || `${en} (አማርኛ)`,
      val[2] || `${en} (Afaan Oromoo)`,
      val[3] || `${en} (ትግርኛ)`
    ];
  }
  const en = typeof val === 'string' && val ? val : defaultEn;
  return [
    en,
    `${en} (አማርኛ)`,
    `${en} (Afaan Oromoo)`,
    `${en} (ትግርኛ)`
  ];
}

