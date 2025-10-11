const yearRangeLabel = (start, end) => {
  const startYear = Number.isInteger(start) ? start : null;
  const endYear = Number.isInteger(end) ? end : null;

  if (startYear && endYear) {
    if (startYear === endYear) return ` [${startYear}]`;
    return ` [${startYear}-${endYear}]`;
  }
  if (startYear) return ` [${startYear}-]`;
  if (endYear) return ` [-${endYear}]`;
  return '';
};

const formatApplicationDisplay = (row) => {
  const parts = [row.make, row.model, row.engine].filter(Boolean);
  const base = parts.join(' ').trim();
  const suffix = yearRangeLabel(row.year_start, row.year_end);
  return `${base}${suffix}`.trim();
};

const fetchPartApplications = async (client, partId) => {
  const query = `
    SELECT *
    FROM (
      SELECT
        'legacy'::text AS source,
        pa.part_app_id AS link_id,
        pa.part_id,
        pa.application_id,
        a.make_id,
        a.model_id,
        a.engine_id,
        vmk.make_name AS make,
        vmd.model_name AS model,
        veng.engine_name AS engine,
        pa.year_start,
        pa.year_end,
        NULL::text AS notes,
        NULL::timestamptz AS created_at,
        NULL::timestamptz AS updated_at
      FROM part_application pa
      JOIN application a ON a.application_id = pa.application_id
      LEFT JOIN vehicle_make vmk ON vmk.make_id = a.make_id
      LEFT JOIN vehicle_model vmd ON vmd.model_id = a.model_id
      LEFT JOIN vehicle_engine veng ON veng.engine_id = a.engine_id
      WHERE pa.part_id = $1

      UNION ALL

      SELECT
        'flex'::text AS source,
        paf.part_app_flex_id AS link_id,
        paf.part_id,
        NULL::integer AS application_id,
        NULL::integer AS make_id,
        NULL::integer AS model_id,
        NULL::integer AS engine_id,
        paf.make_name AS make,
        paf.model_name AS model,
        paf.engine_name AS engine,
        paf.year_start,
        paf.year_end,
        paf.notes,
        paf.created_at,
        paf.updated_at
      FROM part_application_flexible paf
      WHERE paf.part_id = $1
    ) combined
    ORDER BY (make IS NULL) ASC, make NULLS LAST, (model IS NULL) ASC, model NULLS LAST, (engine IS NULL) ASC, engine NULLS LAST;
  `;
  const { rows } = await client.query(query, [partId]);
  return rows;
};

const buildApplicationsJson = (rows) => rows.map((row) => ({
  source: row.source,
  link_id: row.link_id,
  application_id: row.application_id,
  make_id: row.make_id,
  model_id: row.model_id,
  engine_id: row.engine_id,
  make: row.make,
  model: row.model,
  engine: row.engine,
  year_start: row.year_start,
  year_end: row.year_end,
  notes: row.notes,
  display: formatApplicationDisplay(row)
}));

const buildSearchableApplications = (rows) => {
  return rows
    .map(formatApplicationDisplay)
    .filter((label) => label && label.length > 0);
};

module.exports = {
  fetchPartApplications,
  buildApplicationsJson,
  buildSearchableApplications,
  formatApplicationDisplay,
  yearRangeLabel,
};
