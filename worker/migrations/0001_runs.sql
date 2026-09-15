-- One row per run, the game-over summary flattened into columns so later
-- analysis (the persisted player model) can query without parsing JSON.
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,                 -- ms since epoch, server clock
  device TEXT NOT NULL,                -- anonymous per-device id
  tag TEXT NOT NULL,                   -- 1..3 uppercase letters or digits
  variant TEXT NOT NULL DEFAULT 'default',
  slot TEXT NOT NULL DEFAULT '',
  build TEXT NOT NULL DEFAULT '',
  time REAL NOT NULL,                  -- survival seconds
  death TEXT NOT NULL,
  reaction_median REAL,
  reaction_p90 REAL,
  reaction_n INTEGER NOT NULL DEFAULT 0,
  anticipation REAL,
  anticipation_n INTEGER NOT NULL DEFAULT 0,
  beat_r REAL,
  beat_phase REAL,
  beat_n INTEGER NOT NULL DEFAULT 0,
  overshoots INTEGER NOT NULL DEFAULT 0,
  reversals INTEGER NOT NULL DEFAULT 0,
  countin_onsets INTEGER,
  countin_r REAL,
  tuning TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_runs_at ON runs(at);
CREATE INDEX IF NOT EXISTS idx_runs_time ON runs(time);
