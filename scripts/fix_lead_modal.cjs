const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'admin', 'app.js');
let code = fs.readFileSync(filePath, 'utf8');

// Find the exact block to replace (line 1250-1291)
const oldBlock = `window.viewLeadDetails = function(leadId) {
  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  const modal = document.getElementById('lead-modal');
  const content = document.getElementById('lead-modal-content');

  content.innerHTML = \`
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="background:var(--bg-muted); padding:16px; border-radius:var(--radius-md);">
        <h4 style="margin-bottom:8px;">\${esc(lead.name || 'Anonymous Student')}</h4>
        <p><strong>Phone:</strong> \${esc(lead.phone || 'N/A')} · <strong>Email:</strong> \${esc(lead.email || 'N/A')}</p>
        <p><strong>Preferred Contact:</strong> \${esc(lead.pref || 'N/A')} · <strong>City:</strong> \${esc(lead.city || 'N/A')}</p>
        <p><strong>Submitted:</strong> \${new Date(lead.created_at).toLocaleString()}</p>
      </div>

      <div>
        <h5 style="margin-bottom:6px;">Academic Profile &amp; Goals</h5>
        <p><strong>Education Level:</strong> \${esc(lead.level || 'N/A')}</p>
        <p><strong>Desired Field:</strong> \${esc(lead.field || 'N/A')}</p>
        <p><strong>Intake Target:</strong> \${esc(lead.intake || 'N/A')}</p>
        <p><strong>Target Countries:</strong> \${(lead.countries || []).join(', ') || 'None selected'}</p>
      </div>

      \${lead.summary ? \`
        <div>
          <h5 style="margin-bottom:6px;">Assessment Summary</h5>
          <div style="background:#F8FAFC; padding:12px; border-radius:var(--radius-md); border:1px solid var(--border); font-size:13px;">
            \${esc(lead.summary)}
          </div>
        </div>
      \` : ''}

      <div>
        <h5 style="margin-bottom:6px;">Questionnaire Answers</h5>
        <pre style="background:#F8FAFC; padding:12px; border-radius:var(--radius-md); font-size:11px; max-height:180px; overflow-y:auto;">\${esc(JSON.stringify(lead.answers || {}, null, 2))}</pre>
      </div>
    </div>
  \`;

  modal.style.display = 'flex';
};`;

const newBlock = `// Label maps for lead fields
const LEVEL_LABELS = {
  'primary': 'Primary School', 'secondary': 'Secondary School',
  'diploma': 'Diploma / Certificate', 'ba': "Bachelor's Degree",
  'bachelors': "Bachelor's Degree", 'bachelor': "Bachelor's Degree",
  'ma': "Master's Degree", 'masters': "Master's Degree", 'master': "Master's Degree",
  'phd': 'PhD / Doctorate', 'doctorate': 'PhD / Doctorate',
  'undergrad': 'Undergraduate', 'postgrad': 'Postgraduate'
};
const FIELD_LABELS = {
  'it': 'Computer Science / IT', 'cs': 'Computer Science / IT',
  'med': 'Medicine', 'medicine': 'Medicine',
  'eng': 'Engineering', 'engineering': 'Engineering',
  'biz': 'Business', 'business': 'Business / Management',
  'law': 'Law', 'edu': 'Education', 'arts': 'Arts & Humanities',
  'science': 'Natural Sciences', 'social': 'Social Sciences'
};
const INTAKE_LABELS = {
  'soon': 'Within 6 months', 'asap': 'As soon as possible',
  '6months': 'Within 6 months', '1year': 'Within 1 year',
  '2years': 'Within 2 years', 'flexible': 'Flexible / Not sure'
};
const LANG_LABELS = { 'en': 'English', 'am': 'Amharic', 'om': 'Afaan Oromo', 'ti': 'Tigrinya' };
const COUNTRY_DISPLAY = {
  'usa': '🇺🇸 United States', 'uk': '🇬🇧 United Kingdom', 'canada': '🇨🇦 Canada',
  'germany': '🇩🇪 Germany', 'france': '🇫🇷 France', 'australia': '🇦🇺 Australia',
  'netherlands': '🇳🇱 Netherlands', 'sweden': '🇸🇪 Sweden', 'norway': '🇳🇴 Norway',
  'finland': '🇫🇮 Finland', 'denmark': '🇩🇰 Denmark', 'switzerland': '🇨🇭 Switzerland',
  'austria': '🇦🇹 Austria', 'italy': '🇮🇹 Italy', 'spain': '🇪🇸 Spain',
  'china': '🇨🇳 China', 'japan': '🇯🇵 Japan', 'turkey': '🇹🇷 Turkey',
  'hungary': '🇭🇺 Hungary', 'poland': '🇵🇱 Poland', 'czechia': '🇨🇿 Czechia',
  'ireland': '🇮🇪 Ireland', 'newzealand': '🇳🇿 New Zealand'
};

function labelVal(val, map) {
  if (!val) return '—';
  const k = String(val).toLowerCase().replace(/[\s_-]+/g, '');
  return map[k] || (String(val).charAt(0).toUpperCase() + String(val).slice(1));
}

function parseSummaryPairs(summary) {
  if (!summary) return [];
  const pairs = [];
  // Match "Label: Value" patterns, label is Title Case words
  const regex = /([A-Z][A-Za-z &\\/]+?):\s*(.+?)(?=\s{2,}[A-Z][A-Za-z &\\/]+?:|[\u00b7\u2022]|$)/g;
  // Also try splitting on common delimiters
  const cleaned = summary.replace(/[\u00b7\u2022]/g, '  ');
  let m;
  while ((m = regex.exec(cleaned)) !== null) {
    const key = m[1].trim();
    const val = m[2].trim().replace(/\s*[\u00b7\u2022]\s*$/, '');
    if (key && val && key.length < 50 && !pairs.find(p => p[0] === key)) {
      pairs.push([key, val]);
    }
  }
  return pairs;
}

window.viewLeadDetails = function(leadId) {
  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  const modal = document.getElementById('lead-modal');
  const content = document.getElementById('lead-modal-content');

  const countryTags = (lead.countries || [])
    .map(c => {
      const display = COUNTRY_DISPLAY[c.toLowerCase()] || (c.charAt(0).toUpperCase() + c.slice(1));
      return \`<span style="display:inline-block;background:var(--bg-muted);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:12px;margin:2px;">\${esc(display)}</span>\`;
    }).join('') || '<span style="color:var(--text-muted);">—</span>';

  const prefColor = (lead.pref === 'email') ? '#3B82F6' : '#9A288D';

  const summaryPairs = parseSummaryPairs(lead.summary || '');
  const answers = lead.answers || {};
  const answerKeys = Object.keys(answers);

  function tableRow(key, val, last) {
    return \`<div style="display:grid;grid-template-columns:150px 1fr;border-bottom:\${last ? 'none' : '1px solid var(--border)'};">
      <div style="padding:9px 14px;background:var(--bg-muted);font-size:12px;font-weight:600;color:var(--text-muted);border-right:1px solid var(--border);white-space:nowrap;">\${esc(key)}</div>
      <div style="padding:9px 14px;font-size:13px;color:var(--text-primary);">\${esc(val)}</div>
    </div>\`;
  }

  content.innerHTML = \`
    <div style="display:flex;flex-direction:column;gap:20px;">

      <!-- Contact Card -->
      <div style="background:var(--bg-muted);padding:18px 20px;border-radius:var(--radius-md);border-left:4px solid #9A288D;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:12px;">
          <h4 style="margin:0;font-size:17px;">\${esc(lead.name || 'Anonymous Student')}</h4>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span style="background:\${prefColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">\${esc(lead.pref || 'phone')}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Phone</div>
            <div style="font-weight:600;">\${esc(lead.phone || '—')}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Email</div>
            <div style="font-weight:600;">\${lead.email ? \`<a href="mailto:\${esc(lead.email)}" style="color:#9A288D;">\${esc(lead.email)}</a>\` : '—'}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">City</div>
            <div style="font-weight:600;">\${esc(lead.city || '—')}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Submitted</div>
            <div style="font-size:12px;color:var(--text-muted);">\${new Date(lead.created_at).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <!-- Academic Profile -->
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">📚 Academic Profile &amp; Goals</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Education Level</div>
            <div style="font-weight:600;font-size:13px;">\${esc(labelVal(lead.level, LEVEL_LABELS))}</div>
          </div>
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Desired Field</div>
            <div style="font-weight:600;font-size:13px;">\${esc(labelVal(lead.field, FIELD_LABELS))}</div>
          </div>
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Target Intake</div>
            <div style="font-weight:600;font-size:13px;">\${esc(labelVal(lead.intake, INTAKE_LABELS))}</div>
          </div>
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">UI Language</div>
            <div style="font-weight:600;font-size:13px;">\${esc(labelVal(lead.language, LANG_LABELS))}</div>
          </div>
        </div>
        <div style="background:var(--bg-muted);padding:12px 14px;border-radius:var(--radius-md);">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Target Countries</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">\${countryTags}</div>
        </div>
      </div>

      <!-- Full Assessment Details as structured table -->
      \${summaryPairs.length > 0 ? \`
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">📋 Full Assessment Details</div>
          <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
            \${summaryPairs.map(([k, v], i) => tableRow(k, v, i === summaryPairs.length - 1)).join('')}
          </div>
        </div>
      \` : lead.summary ? \`
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">📋 Assessment Summary</div>
          <div style="background:var(--bg-muted);padding:14px;border-radius:var(--radius-md);font-size:13px;line-height:1.65;color:var(--text-primary);">\${esc(lead.summary)}</div>
        </div>
      \` : ''}

      <!-- Raw answers only if no summary available -->
      \${!lead.summary && answerKeys.length > 0 ? \`
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">📋 Questionnaire Answers</div>
          <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
            \${answerKeys.map((k, i) => tableRow(
              k.replace(/_/g,' ').replace(/\\b\\w/g, c => c.toUpperCase()),
              Array.isArray(answers[k]) ? answers[k].join(', ') : String(answers[k]),
              i === answerKeys.length - 1
            )).join('')}
          </div>
        </div>
      \` : ''}

    </div>
  \`;

  modal.style.display = 'flex';
};`;

if (code.includes(oldBlock)) {
  code = code.replace(oldBlock, newBlock);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('SUCCESS: viewLeadDetails replaced.');
} else {
  // Try a more lenient match using line numbers
  const lines = code.split('\n');
  const startLine = 1249; // 0-indexed = line 1250
  const endLine = 1291;   // 0-indexed = line 1292 (inclusive)
  const before = lines.slice(0, startLine).join('\n');
  const after = lines.slice(endLine).join('\n');
  const updated = before + '\n' + newBlock + '\n' + after;
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('SUCCESS: viewLeadDetails replaced via line splice.');
}
