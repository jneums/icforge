-- Make project slugs globally unique (not just per-user) for subdomain routing
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_id_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_unique ON projects(slug);
