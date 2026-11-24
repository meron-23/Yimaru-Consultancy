// Builds the text the AI assistant reads, from the same rows the website and admin use.
// Shared by the chat server (worker.js) and the admin panel's "What the AI reads" preview.
// Input: { countries:[countryData], scholarships:[scholarshipData], content:{faq, sc_1..sc_6, pol_how, usa_note}, notes:[{title, body}], contact:{tg,wa,phone,email} }
export function buildKnowledge(src) {
  const strip = t => String(t == null ? "" : t).replace(/<li>/g, "\n- ").replace(/<\/p>\s*<p>/g, " ").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").trim();
  const en = v => strip(Array.isArray(v) ? v[0] : (v || ""));
  const lv = n => ["very limited", "limited", "good", "strong"][n] || "";
  const C = src.content || {}, K = src.contact || {};
  const L = [];
  L.push("# ABOUT YIMARU CONSULTING");
  L.push("Yimaru Consulting (part of Yimaru Academy) is a study-abroad consultancy for Ethiopian students. Office: Town Square Mall, Addis Ababa.");
  L.push(`Contact: Telegram ${K.tg || ""} · WhatsApp ${K.wa || ""} · Phone ${K.phone || ""} · Email ${K.email || ""}.`);
  L.push("The website has a free study plan (a short questionnaire that matches the student to countries) and pages for every country and scholarship below.");
  L.push("");
  if (Array.isArray(C.faq) && C.faq.length) {
    L.push("# FREQUENTLY ASKED QUESTIONS");
    for (const [q, a] of C.faq) L.push(`Q: ${en(q)}\nA: ${en(a)}`);
    L.push("");
  }
  L.push("# DOCUMENTS EVERY STUDENT NEEDS (ETHIOPIA)");
  L.push("- Grade 12 certificate (and transcripts/degree for master's), authenticated at ETA (education authority) and then the Ministry of Foreign Affairs.");
  L.push("- A valid passport. Apply early, it can take months.");
  L.push("- Proof of funds (bank statements), usually showing the money has been in the account for some months.");
  if (C.pol_how) L.push("- Police certificate where the country asks for it: " + en(C.pol_how));
  L.push("");
  const sc = [1, 2, 3, 4, 5, 6].map(i => C["sc_" + i]).filter(Boolean);
  if (sc.length) { L.push("# SCAM WARNINGS"); sc.forEach(s => L.push("- " + en(s))); L.push(""); }
  const schById = {}; (src.scholarships || []).forEach(s => schById[s.id] = s);
  L.push("# DESTINATIONS");
  for (const c of src.countries || []) {
    const a = c.ai || {}, f = c.facts || {};
    L.push(`## ${en(c.name)}`);
    L.push(`Summary: ${en(c.tag)}. ${en(c.desc)}`);
    if (a.cnote) L.push(`Key point: ${en(a.cnote)}`);
    L.push(`Tuition: ${c.tu}. Living: ${c.li}. English: ${en(c.en)}.${c.min ? ` Lowest realistic yearly budget for tuition and living: about $${Number(c.min.budget || 0).toLocaleString("en-US")}. Minimum English: IELTS ${c.min.ielts} or equal.` : ""}`);
    L.push(`Facts: tuition ${f.tu || ""}; living ${f.li || ""}; intakes ${f.in || ""}; processing ${f.pr || ""}; language ${f.la || ""}.`);
    if (c.unis && c.unis.length) L.push(`Example universities: ${c.unis.join(", ")}.${a.unis ? ` About ${a.unis} universities in total.` : ""}`);
    if (c.fields && c.fields.length) L.push(`Popular fields: ${c.fields.join(", ")}.`);
    L.push(`Visa: ${c.visa || ""}. Steps: ${(c.steps || []).map((s, i) => (i + 1) + ") " + s).join(" ")}`);
    if (a.prev) L.push(`Paid or shown before the visa: ${en(a.prev)}`);
    if (a.docs) L.push(`Extra documents and health checks: ${en(a.docs)}`);
    if (a.vtip) L.push(`Visa tip: ${en(a.vtip)}`);
    L.push(`Work while studying${a.work_lv != null ? " (" + lv(a.work_lv) + ")" : ""}: ${en(c.work)}`);
    if (a.earn) L.push(`Earnings: ${en(a.earn)}`);
    if (a.stay_lv != null) L.push(`Staying after graduation: ${lv(a.stay_lv)}${a.stay ? " (" + en(a.stay) + ")" : ""}.`);
    if (a.g12) L.push(`Grade 12 route: ${en(a.g12)}`);
    if (c.id === "usa" && C.usa_note) L.push("OPT note: " + en(C.usa_note));
    if (c.tips && c.tips.length) L.push(`Tips: ${c.tips.map(en).join(" ")}`);
    const sch = (c.sch || []).map(id => schById[id]).filter(Boolean).map(s => s.name);
    if (sch.length) L.push(`Scholarships: ${sch.join(", ")}.`);
    L.push("");
  }
  L.push("# SCHOLARSHIPS");
  for (const s of src.scholarships || []) {
    L.push(`## ${s.name}`);
    L.push(`Levels: ${(s.lv || []).join(", ")} (ba = bachelor's, ma = master's, phd = PhD). Coverage: ${s.cov === "full" ? "full" : "partial"}. Covers: ${en(s.covers)}.`);
    L.push(`When to apply: ${en(s.win)}. Who can apply: ${(s.who || []).map(en).join("; ")}.`);
    if (s.age) L.push(`Age limits: ${JSON.stringify(s.age)}.`);
    if (s.note) L.push(`Note: ${en(s.note)}`);
    if (s.url) L.push(`Official site: ${s.url}`);
    L.push("");
  }
  const notes = (src.notes || []).filter(n => n && n.body);
  if (notes.length) {
    L.push("# ADVISOR EXPERIENCE (Yimaru's advisors)");
    L.push("These notes come from Yimaru's advisors. They are practical guidance, not official rules. Percentages and waiting times are rough estimates. When you use them, say they are from our advisors' experience and are not a guarantee.");
    for (const n of notes) { L.push(`## ${n.title}`); L.push(String(n.body).trim()); L.push(""); }
  }
  return L.join("\n");
}
