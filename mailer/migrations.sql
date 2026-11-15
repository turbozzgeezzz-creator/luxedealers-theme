-- Columns added after the first deploy. deploy.sh runs each line on its own and ignores "duplicate column" errors.
ALTER TABLE subscribers ADD COLUMN tz TEXT;
ALTER TABLE subscribers ADD COLUMN tz_source TEXT;
ALTER TABLE subscribers ADD COLUMN country TEXT;
ALTER TABLE subscribers ADD COLUMN tz_checked INTEGER;
