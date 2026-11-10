-- Radio-owned documentation. Avoids the root-owned, read-only-to-node /backups bind.
-- Migration touches no RADIUS, login, network-map or core tables.
-- NULL coordinates/destination are explicit cleared tombstones for legacy JSON fallback.
CREATE TABLE radio_doc_locations (
  host_id text PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  latitude double precision,
  longitude double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radio_doc_both_coordinates CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT radio_doc_latitude_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT radio_doc_longitude_range CHECK (longitude BETWEEN -180 AND 180)
);

CREATE TABLE radio_doc_uplinks (
  ap_id text PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  destination_id text REFERENCES hosts(id) ON DELETE SET NULL,
  port text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
