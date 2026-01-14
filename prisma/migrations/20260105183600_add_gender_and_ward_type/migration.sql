-- Add missing columns to organization_wards table
ALTER TABLE organization_wards ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE organization_wards ADD COLUMN IF NOT EXISTS ward_type text;
