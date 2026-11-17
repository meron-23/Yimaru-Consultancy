const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const idx = html.indexOf('src="data:image/png;base64,');
if (idx === -1) { console.log('Not found'); process.exit(1); }
const start = idx + 'src="data:image/png;base64,'.length;
const end = html.indexOf('"', start);
const base64 = html.slice(start, end);
console.log('Found logo, length:', base64.length);
fs.writeFileSync('favicon.png', Buffer.from(base64, 'base64'));
console.log('Saved favicon.png');
