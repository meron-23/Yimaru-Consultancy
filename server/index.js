import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';

// Load environment variables from .env if present
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const ADMIN_DIR = path.join(ROOT_DIR, 'admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Request logging in development
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api')) {
        console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
      }
    });
  }
  next();
});

// API Routes
app.use('/api', apiRouter);

// Serve Admin UI static files
app.use('/admin', express.static(ADMIN_DIR));
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'index.html'));
});

// Serve Public Website static files
app.use(express.static(ROOT_DIR, { index: false }));

// Root route serves public website
app.get('/', (req, res) => {
  const primaryHtml = path.join(ROOT_DIR, 'index.html');
  const fallbackHtml = path.join(ROOT_DIR, 'Yimaru Consulting Website (1).html');
  res.sendFile(primaryHtml, (err) => {
    if (err) {
      res.sendFile(fallbackHtml);
    }
  });
});

// Catch-all 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack || err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start server unless running in test mode
let serverInstance = null;
const isTestMode = process.env.NODE_ENV === 'test' || process.argv[1]?.includes('test');
if (!isTestMode) {
  serverInstance = app.listen(PORT, () => {
    console.log(`
===========================================================
  🎓 Yimaru Consulting AI-Powered CMS Server Running!
  ---------------------------------------------------------
  🌐 Public Website : http://localhost:${PORT}/
  🔐 Admin Panel    : http://localhost:${PORT}/admin
  📡 API Base URL   : http://localhost:${PORT}/api
===========================================================
    `);
  });
}

export { app, serverInstance };
