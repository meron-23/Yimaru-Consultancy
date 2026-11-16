# 🎓 Yimaru Consulting — AI-Powered Content Management System

A production-ready, AI-driven content management and publishing platform built for **Yimaru Consulting** (an educational consultancy helping Ethiopian students study abroad).

This platform extends the existing starter website while strictly preserving its visual design, interactive qualification checker, multilingual dictionary, and lead capture workflows. It adds an intuitive, responsive, and secure Admin Panel for non-technical content managers to ingest scholarship documents and country guides, extract structured data via AI, generate 4-language translations, review facts with non-hallucination guardrails, and publish content live.

---

## 🌟 Key Features

1. **Non-Destructive Integration**: Preserves 100% of the public website (`index.html` & `Yimaru Consulting Website (1).html`), styles, qualification assessment tree, and animations.
2. **AI Document & Web Ingestion**:
   - Ingest PDF, Word DOCX, and TXT files via drag-and-drop.
   - Paste official scholarship / university web page URLs (protected against SSRF).
   - Paste raw bulletin text directly.
   - Automatic content classification (`country` vs `scholarship`).
   - Scanned PDF detection with explicit alerts for documents lacking an extractable text layer.
3. **4-Language Content Synthesis**:
   - Generates and synchronizes all content across the 4 supported languages:
     - 🇬🇧 **English** (index 0)
     - 🇪🇹 **Amharic / አማርኛ** (index 1)
     - 🇪🇹 **Afaan Oromoo** (index 2)
     - 🇪🇹 **Tigrinya / ትግርኛ** (index 3)
   - Stored in the native array structure `[en, am, om, ti]` expected by the existing frontend.
   - Individual translation inspection, inline editing, and single-field translation regeneration.
4. **Publishing Workflow & Status Management**:
   - Workflow: `Upload → AI Processing → Review → Save Draft → Approve → Publish`.
   - Distinct statuses: `processing`, `draft`, `needs_review`, `published`, `archived`.
   - AI-generated content **never** goes live automatically.
   - Drafts and archived items are strictly hidden from public visitors via server filters and Supabase Row Level Security (RLS).
5. **Dual-Mode Persistence Architecture**:
   - **Supabase Cloud Mode**: Seamless connection to live Supabase PostgreSQL tables and Row Level Security policies.
   - **Standalone Local Store Mode**: Built-in persistent fallback store (`server/data/store.json`) seeded with all 15 starter countries and 13 starter scholarships, enabling 100% functionality offline or without external cloud credentials.
6. **Student Lead Capture Management**:
   - Inquiries and completed assessments from the website checker flow directly into the Admin Leads Manager.
   - Complete assessment details, GPA/level, target countries, and contact preferences are presented cleanly.

---

## 📁 Project Structure

```text
├── admin/                           # Admin Panel Frontend Single-Page App
│   ├── index.html                   # Responsive Admin UI
│   ├── style.css                    # Yimaru brand styles, responsive grid, dark/light cards
│   └── app.js                       # Client logic, review studio, translation editor, auth
├── server/                          # Backend Application Server
│   ├── index.js                     # Express entry point, static asset serving, routes
│   ├── auth.js                      # JWT signing/verification, bcrypt hashing, Supabase Auth
│   ├── ai/
│   │   └── index.js                 # Document parsing, SSRF-safe scraper, Gemini/OpenAI engine,
│   │                                # heuristic translation fallback, Zod schema validation
│   ├── db/
│   │   └── index.js                 # Dual-mode DB layer (Supabase + local persistent store)
│   ├── routes/
│   │   └── api.js                   # REST API routes (auth, countries, scholarships, leads, ai)
│   └── data/
│       └── store.json               # Local persistent database store (with seed data)
├── supabase/                        # Database Infrastructure & Migrations
│   ├── migrations/
│   │   └── 20261116000000_init_schema.sql  # Full schema, RLS policies, audit logs, storage
│   ├── seed.sql                     # SQL seed with 15 countries, 13 scholarships, site settings
│   └── seed.json                    # JSON seed extracted directly from starter website
├── scripts/
│   ├── extract_seed.cjs             # Seed data extractor from HTML
│   └── prepare_index.js             # Connects starter HTML to backend / Supabase
├── test/
│   └── run-tests.js                 # Comprehensive automated test suite (36 tests)
├── index.html                       # Live Public Website with real-time remote sync
├── Yimaru Consulting Website (1).html # Original starter website (preserved untouched)
├── .env.example                     # Sample environment variable configuration
└── package.json                     # Dependencies & npm scripts
```

---

## 🚀 Quick Start (Local Run)

### 1. Prerequisites
- Node.js v18+ (tested on Node v24)
- npm v9+

### 2. Installation
Clone or navigate to the project directory:
```bash
cd "c:\Users\user\Downloads\Yimaru Consulting Website"
npm install
```

### 3. Run the Automated Test Suite
Verify that all 36 verification criteria pass:
```bash
npm test
```

### 4. Start the Application
```bash
npm start
```
The application server will be available at:
- 🌐 **Public Website**: [http://localhost:3000/](http://localhost:3000/)
- 🔐 **Admin Panel**: [http://localhost:3000/admin](http://localhost:3000/admin)
- 📡 **API Base**: [http://localhost:3000/api](http://localhost:3000/api)

### 5. Log in to the Admin Panel
Use the default administrator credentials:
- **Email**: `admin@yimaru.com`
- **Password**: `AdminYimaru2026!`

*(You can change this password or add additional admins in the settings or database)*.

---

## ☁️ Supabase Configuration & Migrations

The platform is designed to work with Supabase out of the box.

### Step 1: Create a Supabase Project
1. Log in to your [Supabase Dashboard](https://supabase.com).
2. Click **New Project** and name it (e.g., `yimaru-consulting`).
3. Note your project URL and keys from **Project Settings → API**:
   - `Project URL` (e.g. `https://xyzcompany.supabase.co`)
   - `anon public key`
   - `service_role secret key`

### Step 2: Run Database Migration
In your Supabase project dashboard, navigate to the **SQL Editor**, create a new query, and paste the contents of:
```text
supabase/migrations/20261116000000_init_schema.sql
```
Click **Run**. This creates:
- `countries` table (with `id`, `data` jsonb, `featured`, `sort`, `status`, `published` generated column).
- `scholarships` table (with `id`, `data` jsonb, `featured`, `sort`, `status`, `published` generated column).
- `site_content` table (for FAQs, stopovers, and contact settings).
- `leads` table (for student checker inquiries).
- `content_documents` table (for uploaded PDF/Word tracking).
- `audit_logs` table (for tracking admin actions).
- Storage bucket `content-documents`.
- **Row Level Security (RLS)** policies ensuring public visitors can only read published records, while authenticated admins have full management access.

### Step 3: Populate Initial Seed Data
In the **SQL Editor**, run the contents of:
```text
supabase/seed.sql
```
This inserts the 15 starter study destinations (USA, Canada, Germany, UK, etc.) and 13 scholarships (DAAD, Chevening, Turkiye Burslari, etc.) as live published records.

### Step 4: Configure Environment Variables
Create a `.env` file in the project root (copied from `.env.example`):
```env
PORT=3000
NODE_ENV=production
JWT_SECRET=your-random-32-character-secret

SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

GEMINI_API_KEY=your-gemini-api-key
```

Restart the server (`npm start`). The CMS will automatically connect to Supabase and show **Supabase Connected (Live)** in the admin header.

---

## 🤖 AI Provider Configuration

The CMS supports both **Google Gemini** and **OpenAI**:

### Option A: Google Gemini API (Recommended)
1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2. Add to `.env`:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
The system uses `gemini-1.5-flash` with structured JSON schema output and strict non-hallucination instructions.

### Option B: OpenAI API
1. Get an API key from [OpenAI Platform](https://platform.openai.com/).
2. Add to `.env`:
   ```env
   OPENAI_API_KEY=sk-...
   ```
The system uses `gpt-4o-mini` with structured JSON mode.

### Option C: Offline Smart Heuristic Engine (Zero Cost / No API Keys)
If no AI keys are configured, the system automatically falls back to its built-in rule-based extractor and Ethiopian multilingual dictionary. It reliably detects degree levels, tuition formats, funding status, and generates initial 4-language drafts for admin review.

---

## 📖 Content Management Workflow

### 1. Ingest Source Material
1. Go to the **AI Content Studio** (`/admin#/ai-upload`).
2. Select or auto-detect content type (`Country` or `Scholarship`).
3. Choose your input mode:
   - **Document Upload**: Drag and drop a PDF brochure or Word DOCX.
   - **URL Input**: Paste an official scholarship URL (e.g., DAAD or university page).
   - **Text Input**: Paste text from a scholarship flyer.
4. Click **Analyze, Extract & Generate Translations**.

### 2. Review Extracted Information
The system extracts facts and opens the **Review Screen**:
- **Missing Information Banner**: If any critical fields (such as tuition, deadlines, or test requirements) were absent from the source document, an attention banner highlights them.
- **Fact Editing**: Edit any field in real time.
- **4-Language Strip**:
  - Switch between English, Amharic, Afaan Oromo, and Tigrinya.
  - Enable **Side-by-Side** mode to view translations directly against the English original.
  - Click **Regenerate** next to any translation to refine it.

### 3. Save Draft or Publish Live
- Click **Save Draft**: Saves the record safely in the database with status `draft`. It is completely hidden from public website visitors.
- Click **Approve & Publish Live**: Validates all constraints and sets status to `published`. The item immediately appears in public search, destination lists, scholarship filters, and comparison tools on the website.
- Click **Archive**: Moves outdated programs to `archived` status, safely removing them from public listings while retaining history.

---

## 🛡️ Security & Guardrails

- **Zero Client Secrets**: Supabase `service_role` keys and AI API keys are used exclusively on the Express backend and are never sent to client browsers.
- **SSRF Protection**: URL fetching blocks loopback (`127.0.0.1`, `localhost`), internal RFC1918 subnets (`10.x`, `192.168.x`, `172.16.x`), and cloud metadata IP addresses (`169.254.169.254`).
- **File Validation**: Strict file type filtering (`application/pdf`, `application/vnd.openxmlformats...`, `text/plain`) with a 10MB file limit.
- **Scanned PDF Handling**: Scanned documents lacking an extractable text layer trigger a clear user warning instead of failing silently.
- **Row Level Security (RLS)**: Enforced at the PostgreSQL level so unauthenticated users cannot read unpublished content or student leads.

---

## 🚢 Deployment

### Deploying to Render / Railway / Heroku / DigitalOcean
1. Set the build and start commands:
   ```bash
   Build Command: npm install
   Start Command: npm start
   ```
2. Configure environment variables in your hosting provider's dashboard:
   - `PORT=3000`
   - `NODE_ENV=production`
   - `JWT_SECRET=<secure-random-string>`
   - `SUPABASE_URL=<your-supabase-url>`
   - `SUPABASE_ANON_KEY=<your-supabase-anon-key>`
   - `SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>`
   - `GEMINI_API_KEY=<your-gemini-key>`
3. Deploy! The server serves the public website at `/`, the admin panel at `/admin`, and the REST API at `/api`.

