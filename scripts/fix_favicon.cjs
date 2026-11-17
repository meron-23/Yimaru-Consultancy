const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Fix index.html — replace giant base64 favicon with SVG
const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Remove the existing huge base64 PNG favicon link
html = html.replace(/<link rel="icon" type="image\/png" href="data:image\/png;base64,[^"]{10,}">/s, 
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<link rel="apple-touch-icon" href="/favicon.svg">');

fs.writeFileSync(indexPath, html, 'utf8');
console.log('index.html favicon updated. File size:', html.length);

// Fix admin/index.html — add favicon after <title>
const adminPath = path.join(root, 'admin', 'index.html');
let adminHtml = fs.readFileSync(adminPath, 'utf8');

if (!adminHtml.includes('rel="icon"')) {
  adminHtml = adminHtml.replace(
    '</title>',
    `</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/favicon.svg">`
  );
  fs.writeFileSync(adminPath, adminHtml, 'utf8');
  console.log('admin/index.html favicon added.');
} else {
  console.log('admin/index.html already has favicon, skipping.');
}
