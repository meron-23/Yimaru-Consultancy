const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'Yimaru Consulting Website (1).html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract the main script contents
const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/gi);
console.log('Found script tags:', scriptMatches.length);

// Let's create a browser-like sandbox
const sandbox = {
  getComputedStyle: () => ({ fontSize: '16px' }),
  devicePixelRatio: 1,
  scrollY: 0,
  innerHeight: 800,
  innerWidth: 1200,
  scrollTo: () => {},
  fetch: async () => ({ ok: false, json: async () => [] }),
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  requestAnimationFrame: (cb) => cb(),
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  performance: { now: () => Date.now() },
  location: { hash: '', href: 'https://yimaruconsulting.com/' },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  navigator: {
    clipboard: { writeText: async () => {} }
  },
  document: {
    documentElement: { lang: 'en', classList: { add() {}, remove() {}, toggle() {} } },
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    getElementById: () => ({
      innerHTML: '',
      textContent: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild: () => {},
      createTreeWalker: () => ({ nextNode: () => null }),
    querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      getAttribute: () => '',
      getContext: () => ({
        clearRect() {}, createRadialGradient() { return { addColorStop() {} }; },
        beginPath() {}, arc() {}, fill() {}, fillRect() {}, lineTo() {}, moveTo() {}, stroke() {}
      }),
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 500, height: 500 }),
      getTotalLength: () => 100,
      getPointAtLength: () => ({ x: 0, y: 0 })
    }),
    createTreeWalker: () => ({ nextNode: () => null }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  },
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  NodeFilter: { SHOW_TEXT: 4 }
};

sandbox.window = sandbox;

// Run scripts sequentially in sandbox
const stubs = `
var applyI18n = () => {};
var applyI18n4 = () => {};
var renderD = () => {};
var renderDP = () => {};
var renderTeaser = () => {};
var renderSP = () => {};
var renderStops = () => {};
var renderFAQ = () => {};
var renderQ = () => {};
var renderResult = () => {};
var docMock = () => {};
var ladder = () => {};
var route = () => {};
var loadRemote = () => {};
var renderFooter = () => {};
var observe = () => {};
var buildRoute = () => {};
var Globe = () => ({ labels: () => {} });
`;

for (const tag of scriptMatches) {
  let code = stubs + tag.replace(/<\/?script>/gi, '');
  code += `\n; globalThis.__EXTRACTED__ = { D: (typeof D !== 'undefined' ? D : []), S: (typeof S !== 'undefined' ? S : []), FAQ: (typeof FAQ !== 'undefined' ? FAQ : []), STOPS: (typeof STOPS !== 'undefined' ? STOPS : []), C: (typeof C !== 'undefined' ? C : {}), POP: (typeof POP !== 'undefined' ? POP : []) };\n`;
  try {
    vm.runInNewContext(code, sandbox);
  } catch (err) {
    console.log('Script chunk notice:', err.message);
  }
}

const extracted = sandbox.__EXTRACTED__ || {};
const D = extracted.D || [];
const S = extracted.S || [];
const FAQ = extracted.FAQ || [];
const STOPS = extracted.STOPS || [];
const C = extracted.C || {};
const POP = extracted.POP || ["usa","canada","uk","germany"];

console.log(`Extracted: ${D.length} countries, ${S.length} scholarships, ${FAQ.length} FAQs, ${STOPS.length} stops`);

// Save to JSON
const output = {
  countries: D.map((c, idx) => ({
    id: c.id,
    data: c,
    featured: POP.includes(c.id),
    sort: idx + 1,
    status: 'published',
    published: true,
    source_url: 'https://yimaruconsulting.com/destinations/' + c.id
  })),
  scholarships: S.map((s, idx) => ({
    id: s.id,
    data: s,
    featured: idx < 6,
    sort: idx + 1,
    status: 'published',
    published: true,
    source_url: s.url || 'https://yimaruconsulting.com/scholarships/' + s.id
  })),
  site_content: [
    { key: 'faq', value: FAQ },
    { key: 'stops', value: STOPS },
    {
      key: 'settings',
      value: {
        phone: C.phone || '+251946396655',
        phone_display: '+251 94 639 6655',
        email: C.email || 'yimaruacademy@gmail.com',
        whatsapp: C.wa || 'https://wa.me/251946396655',
        telegram: C.tg || 'https://t.me/+251946396655',
        map: 'https://maps.google.com/?q=Town+Square+Mall+Addis+Ababa'
      }
    }
  ]
};

const outDir = path.join(__dirname, '..', 'supabase');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'seed.json'), JSON.stringify(output, null, 2), 'utf8');

// Generate SQL seed file
let sql = `-- Seed data for Yimaru Consulting\n\n`;

for (const c of output.countries) {
  const jsonStr = JSON.stringify(c.data).replace(/'/g, "''");
  sql += `INSERT INTO public.countries (id, data, featured, sort, status, source_url)
VALUES ('${c.id}', '${jsonStr}'::jsonb, ${c.featured}, ${c.sort}, '${c.status}', '${c.source_url}')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, featured = EXCLUDED.featured, sort = EXCLUDED.sort, status = EXCLUDED.status;\n\n`;
}

for (const s of output.scholarships) {
  const jsonStr = JSON.stringify(s.data).replace(/'/g, "''");
  sql += `INSERT INTO public.scholarships (id, data, featured, sort, status, source_url)
VALUES ('${s.id}', '${jsonStr}'::jsonb, ${s.featured}, ${s.sort}, '${s.status}', '${s.source_url}')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, featured = EXCLUDED.featured, sort = EXCLUDED.sort, status = EXCLUDED.status;\n\n`;
}

for (const sc of output.site_content) {
  const jsonStr = JSON.stringify(sc.value).replace(/'/g, "''");
  sql += `INSERT INTO public.site_content (key, value)
VALUES ('${sc.key}', '${jsonStr}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;\n\n`;
}

fs.writeFileSync(path.join(outDir, 'seed.sql'), sql, 'utf8');
console.log('Generated seed.json and seed.sql successfully!');
