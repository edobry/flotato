-- One row per guided-listen verdict, and one per finished walk: anonymous
-- (device id only), so preferences aggregate across people. A verdict row
-- fills step/verdict/base; a finished-walk row fills final. Diffs are JSON
-- objects of tuning keys that differ from the defaults.
CREATE TABLE IF NOT EXISTS prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,                 -- ms since epoch, server clock
  device TEXT NOT NULL,                -- anonymous per-device id
  build TEXT NOT NULL DEFAULT '',
  step TEXT,                           -- guide step id, verdict rows only
  verdict TEXT,                        -- A | B | same | skip, verdict rows only
  base TEXT,                           -- the base diff after the verdict, verdict rows only
  final TEXT                           -- the discovered diff, finished-walk rows only
);

CREATE INDEX IF NOT EXISTS idx_prefs_at ON prefs(at);
