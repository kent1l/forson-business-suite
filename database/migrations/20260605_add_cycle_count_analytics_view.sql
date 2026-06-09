CREATE MATERIALIZED VIEW IF NOT EXISTS employee_cycle_count_performance AS
WITH batch_stats AS (
    SELECT
        employee_id,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg_speed_mins
    FROM cycle_count_batch
    WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND started_at IS NOT NULL
    GROUP BY employee_id
),
line_stats AS (
    SELECT
        b.employee_id,
        COUNT(l.line_id) AS total_lines,
        COUNT(l.line_id) FILTER (WHERE l.status = 'MATCHED_AUTO_APPROVED') AS matched_lines,
        COUNT(l.line_id) FILTER (WHERE l.is_unassigned_find = TRUE) AS discovery_volume
    FROM cycle_count_line l
    JOIN cycle_count_batch b ON l.batch_id = b.batch_id
    GROUP BY b.employee_id
)
SELECT
    e.employee_id,
    TRIM(e.first_name || ' ' || e.last_name) AS employee_name,
    COALESCE(bs.avg_speed_mins, 0) AS avg_speed_mins,
    CASE
        WHEN ls.total_lines > 0 THEN (ls.matched_lines * 100.0) / ls.total_lines
        ELSE 0
    END AS match_accuracy_percent,
    COALESCE(ls.discovery_volume, 0) AS discovery_volume
FROM employee e
LEFT JOIN batch_stats bs ON e.employee_id = bs.employee_id
LEFT JOIN line_stats ls ON e.employee_id = ls.employee_id
WHERE bs.employee_id IS NOT NULL OR ls.employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_cycle_count_performance_employee_id
ON employee_cycle_count_performance (employee_id);
