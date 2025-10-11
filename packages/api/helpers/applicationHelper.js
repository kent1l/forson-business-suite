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
    SELECT
      paf.part_app_flex_id AS link_id,
      paf.part_id,
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
  ORDER BY (paf.make_name IS NULL) ASC, paf.make_name NULLS LAST,
       (paf.model_name IS NULL) ASC, paf.model_name NULLS LAST,
       (paf.engine_name IS NULL) ASC, paf.engine_name NULLS LAST;
  `;
  const { rows } = await client.query(query, [partId]);
  return rows;
};

const buildApplicationsJson = (rows) => rows.map((row) => ({
  source: 'flex',
  link_id: row.link_id,
  make: row.make,
  model: row.model,
  engine: row.engine,
  year_start: row.year_start,
  year_end: row.year_end,
  notes: row.notes,
  created_at: row.created_at,
  updated_at: row.updated_at,
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
