const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Remove any apple-touch-icon with base64 data (old one from previous session)
html = html.replace(/<link rel="apple-touch-icon" href="data:image\/png;base64,[^"]{10,}">/s, '');

// Make sure there's no duplicate apple-touch-icon SVG
const svgAppleCount = (html.match(/<link rel="apple-touch-icon" href="\/favicon\.svg">/g) || []).length;
if (svgAppleCount > 1) {
  // Remove all but keep one
  let first = true;
  html = html.replace(/<link rel="apple-touch-icon" href="\/favicon\.svg">/g, (m) => {
    if (first) { first = false; return m; }
    return '';
  });
}

fs.writeFileSync(indexPath, html, 'utf8');
console.log('Cleaned up. File size:', html.length);

// Verify the head section
const headEnd = html.indexOf('</head>');
console.log('\nHead section:');
console.log(html.substring(0, Math.min(headEnd, 800)));
