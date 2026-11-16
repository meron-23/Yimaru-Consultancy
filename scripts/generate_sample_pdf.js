import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_DIR = path.join(__dirname, '..', 'sample_documents');

const text = "Turkiye Burslari Scholarships 2026 / 2027. Full government scholarship for international students in Turkey. Full tuition fee waiver, free university dormitory accommodation, monthly living stipend, and one-time return flight ticket for Ethiopian applicants. Education levels: Bachelor, Master, and PhD degrees. Application Window: Annually open from January 10 to February 20. Minimum 75% GPA for Bachelor candidates, 80% for Master candidates. Official application link: https://www.turkiyeburslari.gov.tr. Strategic Note: Applying to universities in Ankara or Izmir significantly increases selection probability for Ethiopian students.";

// Clean single stream PDF with accurate byte offsets
const content = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
const contentLen = Buffer.byteLength(content, 'latin1');

const o1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
const o2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
const o3 = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n";
const o4 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
const o5 = `5 0 obj\n<< /Length ${contentLen} >>\nstream\n${content}\nendstream\nendobj\n`;

const header = "%PDF-1.4\n";
const pos1 = Buffer.byteLength(header, 'latin1');
const pos2 = pos1 + Buffer.byteLength(o1, 'latin1');
const pos3 = pos2 + Buffer.byteLength(o2, 'latin1');
const pos4 = pos3 + Buffer.byteLength(o3, 'latin1');
const pos5 = pos4 + Buffer.byteLength(o4, 'latin1');
const startXref = pos5 + Buffer.byteLength(o5, 'latin1');

const pad = n => String(n).padStart(10, '0');
const xref = `xref\n0 6\n0000000000 65535 f \n${pad(pos1)} 00000 n \n${pad(pos2)} 00000 n \n${pad(pos3)} 00000 n \n${pad(pos4)} 00000 n \n${pad(pos5)} 00000 n \n`;
const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

const fullPdf = header + o1 + o2 + o3 + o4 + o5 + xref + trailer;
const pdfPath = path.join(SAMPLE_DIR, 'Turkiye_Burslari_Scholarship_2026.pdf');
fs.writeFileSync(pdfPath, Buffer.from(fullPdf, 'latin1'));
console.log('Saved binary PDF at:', pdfPath);
