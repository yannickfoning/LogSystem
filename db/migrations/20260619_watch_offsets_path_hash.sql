ALTER TABLE watch_offsets
  ADD COLUMN path_hash CHAR(64) NULL FIRST;

UPDATE watch_offsets
  SET path_hash = SHA2(path, 256)
  WHERE path_hash IS NULL;

ALTER TABLE watch_offsets
  DROP PRIMARY KEY;

ALTER TABLE watch_offsets
  MODIFY path TEXT NOT NULL;

ALTER TABLE watch_offsets
  MODIFY path_hash CHAR(64) NOT NULL;

ALTER TABLE watch_offsets
  ADD PRIMARY KEY (path_hash);
