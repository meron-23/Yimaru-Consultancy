-- ==============================================================================
-- Supabase Schema Migration for Yimaru Consulting Website & CMS
-- File: 20261116000000_init_schema.sql
-- ==============================================================================

-- 1. Create custom types and extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Countries table
-- Compatible with query: countries?select=id,data,featured,sort&published=eq.true&order=sort
CREATE TABLE IF NOT EXISTS public.countries (
    id TEXT PRIMARY KEY,                       -- Slug (e.g. 'italy', 'germany')
    data JSONB NOT NULL,                       -- Complete country data structure required by public website
    featured BOOLEAN NOT NULL DEFAULT false,   -- Displayed in top popular countries
    sort INTEGER NOT NULL DEFAULT 0,          -- Sort ordering
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('processing', 'draft', 'needs_review', 'published', 'archived')),
    published BOOLEAN GENERATED ALWAYS AS (status = 'published') STORED,
    source_url TEXT,                          -- Document or website URL from which content was extracted
    source_metadata JSONB DEFAULT '{}'::jsonb,-- Extraction notes, warnings, confidence scores
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_countries_published_sort ON public.countries (published, sort);
CREATE INDEX IF NOT EXISTS idx_countries_status ON public.countries (status);

CREATE TRIGGER update_countries_updated_at
    BEFORE UPDATE ON public.countries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Scholarships table
-- Compatible with query: scholarships?select=id,data,featured,sort&published=eq.true&order=sort
CREATE TABLE IF NOT EXISTS public.scholarships (
    id TEXT PRIMARY KEY,                       -- Slug (e.g. 'daad', 'mcf')
    data JSONB NOT NULL,                       -- Complete scholarship data structure required by public website
    featured BOOLEAN NOT NULL DEFAULT false,   -- Featured in teaser cards
    sort INTEGER NOT NULL DEFAULT 0,          -- Sort ordering
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('processing', 'draft', 'needs_review', 'published', 'archived')),
    published BOOLEAN GENERATED ALWAYS AS (status = 'published') STORED,
    source_url TEXT,                          -- Document or website URL
    source_metadata JSONB DEFAULT '{}'::jsonb,-- Extraction notes, warnings
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scholarships_published_sort ON public.scholarships (published, sort);
CREATE INDEX IF NOT EXISTS idx_scholarships_status ON public.scholarships (status);

CREATE TRIGGER update_scholarships_updated_at
    BEFORE UPDATE ON public.scholarships
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 4. Site Content table
-- Compatible with query: site_content?select=key,value
CREATE TABLE IF NOT EXISTS public.site_content (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_site_content_updated_at
    BEFORE UPDATE ON public.site_content
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Leads table
-- Receives check submissions from the public website
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    city TEXT,
    pref TEXT DEFAULT 'tg',
    language TEXT DEFAULT 'en',
    level TEXT,
    want TEXT,
    field TEXT,
    intake TEXT,
    countries JSONB DEFAULT '[]'::jsonb,
    scholarship TEXT,
    answers JSONB DEFAULT '{}'::jsonb,
    result JSONB DEFAULT '[]'::jsonb,
    summary TEXT,
    consent BOOLEAN DEFAULT false,
    source TEXT,
    notes TEXT,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'consultation_booked', 'closed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);

CREATE TRIGGER update_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. Content Documents table (Track uploaded files & AI extraction history)
CREATE TABLE IF NOT EXISTS public.content_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER,
    storage_path TEXT,
    raw_text TEXT,
    content_type TEXT CHECK (content_type IN ('country', 'scholarship', 'unknown')),
    detected_target_id TEXT,
    extraction_result JSONB,
    missing_fields JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracted', 'reviewed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 7. Audit log table (Track admin actions)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    changes JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholarships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Countries policies:
-- Public can ONLY read published countries
CREATE POLICY "Public users can view published countries"
    ON public.countries
    FOR SELECT
    TO anon, authenticated
    USING (published = true);

-- Authenticated admins can perform any action on countries
CREATE POLICY "Admins have full access to countries"
    ON public.countries
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Scholarships policies:
-- Public can ONLY read published scholarships
CREATE POLICY "Public users can view published scholarships"
    ON public.scholarships
    FOR SELECT
    TO anon, authenticated
    USING (published = true);

-- Authenticated admins can perform any action on scholarships
CREATE POLICY "Admins have full access to scholarships"
    ON public.scholarships
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Site content policies:
-- Public can read all site content
CREATE POLICY "Public users can view site content"
    ON public.site_content
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Authenticated admins can manage site content
CREATE POLICY "Admins can manage site content"
    ON public.site_content
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Leads policies:
-- Anyone (public anon) can insert new leads
CREATE POLICY "Public users can submit leads"
    ON public.leads
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Public users can NEVER select or view leads
CREATE POLICY "Only admins can view leads"
    ON public.leads
    FOR SELECT
    TO authenticated
    USING (true);

-- Authenticated admins can update or delete leads
CREATE POLICY "Admins can manage leads"
    ON public.leads
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Documents & Audit Logs policies:
-- Only authenticated admins have access
CREATE POLICY "Admins only access to content documents"
    ON public.content_documents
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Admins only access to audit logs"
    ON public.audit_logs
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 9. Supabase Storage Bucket for Documents
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-documents', 'content-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins can upload source documents"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'content-documents');

CREATE POLICY "Admins can view and download source documents"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'content-documents');

