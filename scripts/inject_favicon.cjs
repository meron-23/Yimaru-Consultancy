// Generate a small square favicon from the logo PNG by extracting a portion
// and embedding it inline as a data URL in the HTML <head>
const fs = require('fs');

// Read the logo we already extracted
const logoPng = fs.readFileSync('favicon.png');
const logoBase64 = logoPng.toString('base64');
const faviconDataUrl = `data:image/png;base64,${logoBase64}`;

// Read both HTML files and inject favicon tags
const htmlFiles = ['index.html'];

for (const file of htmlFiles) {
  let html = fs.readFileSync(file, 'utf8');

  // Check if favicon already added
  if (html.includes('rel="icon"')) {
    console.log(`${file}: favicon already present, skipping.`);
    continue;
  }

  // Insert favicon links after the <title> tag
  const faviconTags = `
<link rel="icon" type="image/png" href="${faviconDataUrl}">
<link rel="apple-touch-icon" href="${faviconDataUrl}">`;

  html = html.replace(
    '</title>',
    `</title>${faviconTags}`
  );

  fs.writeFileSync(file, html, 'utf8');
  console.log(`${file}: favicon injected.`);
}
