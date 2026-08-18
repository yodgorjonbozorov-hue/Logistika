-- The column called photo_urls has always held StoredFile ids (TASK-3.12, M-4).
--
-- The name promised URLs, so every reader had to know not to believe it. It is
-- renamed rather than converted: a URL stored in a row goes stale, while files
-- are served through the files module, which mints access on demand.
--
-- Renaming keeps the data — no client reads this field yet, so this is the last
-- cheap moment to make the name true.
ALTER TABLE "trip_events" RENAME COLUMN "photo_urls" TO "photo_file_ids";
