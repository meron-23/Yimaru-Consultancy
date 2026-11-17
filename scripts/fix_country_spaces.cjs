const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'admin', 'app.js');
let c = fs.readFileSync(filePath, 'utf8');

// Fix country display values that now have a leading space after emoji removal
// e.g. 'usa': ' United States' -> 'usa': 'United States'
c = c.replace(/'([a-z]+)':\s*' ([A-Z])/g, "'$1': '$2");

fs.writeFileSync(filePath, c, 'utf8');

// Verify
const matches = c.match(/COUNTRY_DISPLAY[\s\S]{0,600}/);
if (matches) console.log(matches[0].substring(0, 400));
