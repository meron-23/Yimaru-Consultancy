const fs = require('fs');
const path = require('path');

const srcPath = 'C:/Users/user/.gemini/antigravity/brain/6a4bd31d-26bf-4aa2-ab31-81a2e17ecaf1/.user_uploaded/media_1794914479259_6381686d.png';
const rootDir = path.join(__dirname, '..');

// 1. Copy image to root favicon.png and admin/favicon.png and favicon.ico
const imgBuffer = fs.readFileSync(srcPath);
fs.writeFileSync(path.join(rootDir, 'favicon.png'), imgBuffer);
fs.writeFileSync(path.join(rootDir, 'admin', 'favicon.png'), imgBuffer);
fs.writeFileSync(path.join(rootDir, 'favicon.ico'), imgBuffer);

console.log('Saved favicon.png, admin/favicon.png, favicon.ico');

// 2. Also update favicon.svg to embed the exact official logo as base64
const base64 = imgBuffer.toString('base64');
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 959 1024" width="100%" height="100%">
  <image width="959" height="1024" xlink:href="data:image/png;base64,${base64}"/>
</svg>
`;
fs.writeFileSync(path.join(rootDir, 'favicon.svg'), svgContent, 'utf8');
console.log('Saved updated favicon.svg');

// 3. Update index.html
const indexPath = path.join(rootDir, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
indexHtml = indexHtml.replace(/<link rel="icon" [^>]+>/, '<link rel="icon" type="image/png" href="/favicon.png">');
indexHtml = indexHtml.replace(/<link rel="apple-touch-icon" [^>]+>/, '<link rel="apple-touch-icon" href="/favicon.png">');
fs.writeFileSync(indexPath, indexHtml, 'utf8');
console.log('Updated index.html favicon tags');

// 4. Update admin/index.html
const adminIndexPath = path.join(rootDir, 'admin', 'index.html');
let adminHtml = fs.readFileSync(adminIndexPath, 'utf8');
adminHtml = adminHtml.replace(/<link rel="icon" [^>]+>/, '<link rel="icon" type="image/png" href="/favicon.png">');
adminHtml = adminHtml.replace(/<link rel="apple-touch-icon" [^>]+>/, '<link rel="apple-touch-icon" href="/favicon.png">');
fs.writeFileSync(adminIndexPath, adminHtml, 'utf8');
console.log('Updated admin/index.html favicon tags');
