// Keep identifiers intact: slashes/hyphens can belong to a single part number.
function getGrnPartNumbers({ part_number, part_numbers } = {}) {
  const seen = new Set();
  return [part_number, ...(Array.isArray(part_numbers) ? part_numbers : [])]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim())
    .filter(value => {
      const key = value.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

module.exports = { getGrnPartNumbers };
