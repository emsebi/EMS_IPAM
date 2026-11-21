-- Preserve existing inherited appearance on upgrade; choice is per saved subnet.
ALTER TABLE prefixes ADD COLUMN IF NOT EXISTS inherit_color_to_children boolean NOT NULL DEFAULT true;
