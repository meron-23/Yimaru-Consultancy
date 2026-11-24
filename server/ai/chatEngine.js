import { askGemini, extractWithGemini, htmlToText } from './prompt.js';
import { buildKnowledge } from './knowledge_core.js';
import { KNOWLEDGE as BUNDLED_KNOWLEDGE } from './knowledge.js';
import { db } from '../db/index.js';

const CONTACT = {
  tg: "https://t.me/+251946396655",
  wa: "https://wa.me/251946396655",
  phone: "+251946396655",
  email: "yimaruacademy@gmail.com"
};

// Rate limiter: 20 messages per 10 minutes per IP
const hits = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = hits.get(ip) || [];
  const valid = record.filter(t => now - t < RATE_WINDOW_MS);
  if (valid.length >= RATE_LIMIT) {
    return false;
  }
  valid.push(now);
  hits.set(ip, valid);
  return true;
}

// 10-minute cache for knowledge base
let knowledgeCache = { at: 0, text: null };
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getKnowledgeText(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && knowledgeCache.text && now - knowledgeCache.at < CACHE_TTL_MS) {
    return knowledgeCache.text;
  }

  try {
    const [countries, scholarships, siteContentList, notes] = await Promise.all([
      db.getCountries({ publishedOnly: true }),
      db.getScholarships({ publishedOnly: true }),
      db.getSiteContent(),
      db.getAiNotes({ activeOnly: true })
    ]);

    const content = {};
    (siteContentList || []).forEach(r => {
      content[r.key] = r.value;
    });

    const settings = content.settings || {};
    const contact = {
      tg: settings.telegram || CONTACT.tg,
      wa: settings.whatsapp || CONTACT.wa,
      phone: settings.phone || CONTACT.phone,
      email: settings.email || CONTACT.email
    };

    const text = buildKnowledge({
      countries: (countries || []).map(c => c.data || c),
      scholarships: (scholarships || []).map(s => s.data || s),
      content,
      notes: notes || [],
      contact
    });

    knowledgeCache = { at: now, text: text || BUNDLED_KNOWLEDGE };
    return knowledgeCache.text;
  } catch (err) {
    console.warn('[AI CHAT] Failed to build dynamic knowledge, falling back to bundled:', err.message);
    return knowledgeCache.text || BUNDLED_KNOWLEDGE;
  }
}

export async function handleChatRequest({ ip, lang, messages, profile, session, page }) {
  if (ip && !checkRateLimit(ip)) {
    return { error: 'busy', status: 429 };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const language = ['en', 'am', 'om', 'ti'].includes(lang) ? lang : 'en';

  const knowledge = await getKnowledgeText();
  const contact = CONTACT;

  let reply = null;
  let errorStatus = 'ok';

  if (!apiKey) {
    // If no API key configured, provide friendly fallback
    reply = language === 'am'
      ? "ሰላም! ረዳታችን በቅርቡ ይዘጋጃል። እባክዎ በቴሌግራም (" + contact.tg + ") አማካሪ ያነጋግሩ።"
      : language === 'om'
        ? "Akkam! Gargaaraan keenya yeroo dhiyootti ni qophaa'a. Maaloo Telegram irratti (" + contact.tg + ") gorsaa qunnami."
        : language === 'ti'
          ? "ሰላም! ሓጋዚና ቀረባ ግዜ ክዳሎ እዩ። በጃኻ ብቴሌግራም (" + contact.tg + ") ኣማኻሪ ተወከስ።"
          : "Hi! Our AI assistant is currently being updated. Please connect with an advisor on Telegram (" + contact.tg + ") or WhatsApp (" + contact.wa + ").";
    errorStatus = 'offline';
  } else {
    try {
      const res = await askGemini({
        key: apiKey,
        model,
        knowledge,
        lang: language,
        profile: profile || '',
        messages: messages || [],
        contact
      });
      reply = res.reply;
    } catch (err) {
      console.error('[AI CHAT] Gemini API error:', err.message);
      if (err.status === 429) {
        errorStatus = 'busy';
      } else {
        errorStatus = 'failed';
      }
    }
  }

  // Check if answer recommends talking to an advisor
  const handoff = reply ? /Telegram|WhatsApp|advisor|አማካሪ|gorsaa|ኣማኻሪ/i.test(reply) : false;

  // Log to database/store
  const lastUserMsg = (messages || []).filter(m => m.role === 'user').slice(-1)[0];
  const question = lastUserMsg ? String(lastUserMsg.text || '') : 'Hello';

  await db.saveChatLog({
    session: session || 'anon',
    lang: language,
    question: question.slice(0, 1000),
    answer: (reply || '').slice(0, 4000),
    model,
    status: errorStatus,
    handoff,
    flagged: false,
    reviewed: false,
    page: page || '/'
  });

  if (errorStatus === 'busy') {
    return { error: 'busy', status: 429 };
  }
  if (!reply && errorStatus === 'failed') {
    return { error: 'failed', status: 500 };
  }

  return { reply };
}

export async function handleExtractRequest({ mode, text, url }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY;
  const model = process.env.GEMINI_EXTRACT_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest';

  let rawText = typeof text === 'string' ? text : '';
  if (!rawText && typeof url === 'string' && /^https?:\/\//.test(url)) {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (YimaruContentStudio)', Accept: 'text/html,text/plain' },
      redirect: 'follow'
    });
    if (!r.ok) {
      throw new Error(`That page could not be opened (HTTP ${r.status}). Paste the text instead.`);
    }
    rawText = htmlToText((await r.text()).slice(0, 2000000));
    rawText = `Source URL: ${url}\n\n` + rawText;
  }

  if (rawText.trim().length < 80) {
    throw new Error('There is not enough text to work with.');
  }

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const result = await extractWithGemini({
    key: apiKey,
    model,
    mode: mode || 'auto',
    text: rawText
  });

  return result;
}
