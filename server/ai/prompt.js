// Shared by the Cloudflare Worker (production) and the local test page / test script.
// Builds the Gemini request for the Yimaru study-abroad assistant.

export const LANG_NAMES = { en: "English", am: "Amharic (አማርኛ)", om: "Afaan Oromoo", ti: "Tigrinya (ትግርኛ)" };

export function systemPrompt(knowledge, lang, profile, contact) {
  const L = LANG_NAMES[lang] || "English";
  return `You are "Yimaru Assistant", the website assistant of Yimaru Consulting, a study-abroad consultancy in Addis Ababa that helps Ethiopian students study abroad.

LANGUAGE
- The student chose ${L} on the website. Reply in ${L} by default.
- If the student writes in a different language (Amharic, Afaan Oromoo, Tigrinya or English), reply in the language they wrote in.
- Amharic and Tigrinya use Ge'ez script. Afaan Oromoo uses Latin script (Qubee). Never mix Amharic and Tigrinya.
- Use simple, everyday words a Grade 12 student in Ethiopia understands. Keep school, visa and university terms (IELTS, visa, Grade 12) as they are.

HOW TO ANSWER
- Keep answers short: 2 to 6 short sentences or a short list. No long essays.
- Use ONLY the information in the KNOWLEDGE section below. The website sections are checked against official sources; the ADVISOR EXPERIENCE section is practical guidance with rough estimates. If they disagree, follow the website sections, and present advisor estimates as "from our advisors' experience", never as guaranteed. If the answer is not there, say you are not sure and suggest asking a Yimaru advisor. Never guess numbers, dates, fees, rules or deadlines.
- Rules and fees change. When you give a fee, amount or rule, add that the student should confirm the latest with an advisor or the official website.
- Never say or suggest that a visa, admission or scholarship is guaranteed.
- Never invent prices for Yimaru's own services. If asked what Yimaru charges, say the first consultation is free and an advisor will explain everything else.
- Never help with fake documents, fake bank statements or lying to an embassy. Explain that it leads to refusal and bans.
- Do not ask for or store passport numbers, bank account numbers or ID numbers. If a student shares them, tell them not to share such details in chat.
- If the student asks about something unrelated to studying abroad, politely say you can only help with studying abroad.
- When the student is ready to apply, wants a personal review, has a visa refusal, or asks something legal or very personal, invite them to talk to a Yimaru advisor on Telegram (${contact.tg}) or WhatsApp (${contact.wa}), or by phone ${contact.phone}.
- Be warm and encouraging, but honest about difficulties (budget, visa refusal risk, English level).
- Plain text only. You may use "- " for a short list. No tables, no markdown headings.

${profile ? `THE STUDENT'S STUDY PLAN ANSWERS (from the website form; use them to personalise answers):\n${profile}\n` : ""}
KNOWLEDGE (Yimaru website content, checked November 2026)
${knowledge}`;
}

// messages: [{role:"user"|"model", text:"..."}]
export function geminiBody(knowledge, lang, profile, messages, contact, gemma) {
  const trimmed = messages.slice(-12).map(m => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: String(m.text || "").slice(0, 1500) }]
  }));
  const sys = systemPrompt(knowledge, lang, profile, contact);
  // Gemma models on the Gemini API do not accept system_instruction, so the instructions go in the first turn.
  if (gemma) {
    trimmed[0] = { role: "user", parts: [{ text: sys + "\n\n---\nSTUDENT MESSAGE:\n" + trimmed[0].parts[0].text }] };
    return { contents: trimmed, generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } };
  }
  return {
    system_instruction: { parts: [{ text: sys }] },
    contents: trimmed,
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
  };
}

export function readReply(json) {
  const c = json && json.candidates && json.candidates[0];
  if (!c || !c.content || !c.content.parts) return null;
  return c.content.parts.filter(p => p.text && !p.thought).map(p => p.text).join("").trim() || null;
}

export async function askGemini({ key, model, knowledge, lang, profile, messages, contact }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(geminiBody(knowledge, lang, profile, messages, contact, /^gemma/.test(model)))
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((json.error && json.error.message) || ("HTTP " + r.status));
    err.status = r.status;
    throw err;
  }
  return { reply: readReply(json), usage: json.usageMetadata || null };
}

/* ===================== AI Content Studio: extraction ===================== */
const L4 = 'an array of 4 strings: [English, Amharic in Ge\'ez script, Afaan Oromoo in Latin script (Qubee), Tigrinya in Ge\'ez script]';
export const EXTRACT_SHAPES = {
  country: `{
 "type": "country",
 "id": "lowercase english name, letters only, e.g. "netherlands"",
 "f": "two-letter ISO country code, lowercase, e.g. "nl"",
 "reg": "one of eu, am, as, me (Europe, Americas, Asia & Pacific, Middle East)",
 "code": "IATA code of the main international airport, e.g. AMS",
 "name": ${L4},
 "tag": ${L4} (one short highlight sentence for Ethiopian students),
 "tu": "short tuition range, e.g. €13,000–20,000/yr",
 "li": "short monthly living cost range, e.g. €1,000–1,500/mo",
 "en": "short English requirement, e.g. IELTS 6.0–6.5",
 "wk": ${L4} (short work rule, e.g. 20 hrs/week),
 "desc": ${L4} (2 to 4 sentences),
 "facts": {"tu":"detailed tuition (English)","li":"detailed living cost and proof of funds (English)","in":"intakes","pr":"visa processing","la":"teaching language"},
 "fields": ["popular fields of study, English"],
 "unis": ["example universities named in the source"],
 "visa": "visa name (English)",
 "steps": ["visa steps in order, English"],
 "work": ${L4} (work while studying and after graduating),
 "tips": [${L4}, ...] (1 to 3 practical tips),
 "min": {"ielts": number or null, "budget": yearly USD for tuition plus living, number or null},
 "geo": [longitude, latitude] of the capital,
 "ai": {"prev": ${L4} (money paid or shown before the visa), "docs": ${L4} (extra documents and health checks), "vtip": ${L4} (one visa tip), "earn": ${L4} (minimum wage and what students can earn)}
}`,
  scholarship: `{
 "type": "scholarship",
 "id": "short lowercase id, letters only, e.g. "daad"",
 "name": "official scholarship name (English)",
 "url": "official website URL if in the source, else empty",
 "fl": ["two-letter lowercase ISO codes of host countries"],
 "code": "IATA code of the main host city airport, EUR for Europe-wide, MULTI for many countries",
 "lv": ["any of ba, ma, phd"],
 "cov": "full or part",
 "inc": ["any of tuition, stipend, housing, flight, insurance, language"],
 "mo": [month numbers 1-12 when applications are usually open],
 "covers": ${L4} (what it pays for),
 "win": ${L4} (application window, e.g. Usually Oct–Jan),
 "who": [${L4}, ...] (2 to 4 eligibility points),
 "note": ${L4} (one advisor note for Ethiopian applicants),
 "age": {"ba": max age or null, "ma": max age or null, "phd": max age or null}
}`,
  note: `{
 "type": "note",
 "title": "short title (English)",
 "body": "the facts from the source as short plain-English lines, one point per line, keeping every number, date and condition exactly"
}`
};

export function extractPrompt(mode) {
  const shapes = mode === "country" ? [EXTRACT_SHAPES.country] : mode === "scholarship" ? [EXTRACT_SHAPES.scholarship] : mode === "note" ? [EXTRACT_SHAPES.note] : [EXTRACT_SHAPES.country, EXTRACT_SHAPES.scholarship];
  return `You prepare content for the Yimaru Consulting website, which helps Ethiopian students study abroad. You receive source material (an official page, bulletin, guide or notes) and return ONE JSON object.

${mode === "auto" ? "First decide whether the source is mainly about a study destination country or a scholarship program, and use the matching shape." : ""}
Shape${shapes.length > 1 ? "s" : ""}:
${shapes.join("\n\nor\n\n")}

Also include:
 "missing": [names of fields you could not fill from the source],
 "warnings": [anything an editor must double-check, e.g. "fees are for 2025/26", "source is a news article, not official"],
 "source_title": "title of the source",
 "source_date": "date or academic year the source refers to, if stated"

STRICT RULES
- Use ONLY facts that appear in the source. Never invent or guess numbers, fees, dates, deadlines, ages, names or links. If something is not in the source, leave it empty ("" or [] or null) and list it in "missing". The only exceptions: ISO country codes, airport codes, region and capital coordinates, which you may fill from general knowledge.
- Copy numbers, currencies and dates exactly as written in the source.
- Translations: every 4-language field must have all 4 entries. Amharic and Tigrinya in Ge'ez script, never mixed with each other. Afaan Oromoo in Latin script (Qubee). Use simple everyday words a Grade 12 student in Ethiopia understands. Keep names of programs, universities, tests (IELTS, TOEFL, Duolingo) and currencies in Latin script.
- Write for Ethiopian students: short, clear, honest. Never promise admission, visas or scholarships.
- Never use the em dash character. Use commas, colons or "to" instead.
- Return only the JSON object, no other text.`;
}

export function extractBody(mode, text) {
  return {
    system_instruction: { parts: [{ text: extractPrompt(mode) }] },
    contents: [{ role: "user", parts: [{ text: "SOURCE MATERIAL:\n\n" + String(text).slice(0, 60000) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 16384, responseMimeType: "application/json" }
  };
}

export async function extractWithGemini({ key, model, mode, text }) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(extractBody(mode, text))
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((json.error && json.error.message) || ("HTTP " + r.status)); e.status = r.status; throw e; }
  const out = readReply(json);
  if (!out) throw new Error("The AI returned nothing. Try a shorter source.");
  try { return JSON.parse(out.replace(/^```(json)?|```$/g, "").trim()); } catch (e) { throw new Error("The AI answer was not valid JSON. Try again or use a shorter source."); }
}

// Turns a web page into plain text (server side).
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
