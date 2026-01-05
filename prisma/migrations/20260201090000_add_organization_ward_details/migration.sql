-- Create organization_ward_details table for detailed beneficiary info.
CREATE TABLE IF NOT EXISTS organization_ward_details (
  organization_ward_id uuid PRIMARY KEY,
  guardian text,
  diseases text[] NOT NULL DEFAULT ARRAY[]::text[],
  medication text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_ward_details_organization_ward_id_fkey
    FOREIGN KEY (organization_ward_id)
    REFERENCES organization_wards(id)
    ON DELETE CASCADE
);

-- Backfill existing notes from organization_wards to the new details table.
INSERT INTO organization_ward_details (
  organization_ward_id,
  notes,
  created_at,
  updated_at
)
SELECT
  id,
  notes,
  created_at,
  updated_at
FROM organization_wards
ON CONFLICT (organization_ward_id) DO NOTHING;

-- Drop notes column from organization_wards (now in details table).
ALTER TABLE organization_wards DROP COLUMN IF EXISTS notes;
