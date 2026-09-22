-- Cycle-count lines identify work that is still tied to a particular part.
-- Make their writes participate in the merge advisory-lock protocol so a merge
-- cannot pass its open-count check while a count is being finalized.
DROP TRIGGER IF EXISTS part_merge_advisory_lock ON cycle_count_line;

CREATE TRIGGER part_merge_advisory_lock
BEFORE INSERT OR UPDATE OR DELETE ON cycle_count_line
FOR EACH ROW EXECUTE FUNCTION lock_part_merge_rows();
