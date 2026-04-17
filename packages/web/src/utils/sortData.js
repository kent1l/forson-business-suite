export const sortData = (rows = [], sortConfig, accessors = {}) => {
    if (!sortConfig?.key) return rows;
    const direction = sortConfig.direction === 'DESC' ? -1 : 1;
    const getValue = accessors[sortConfig.key] || ((row) => row?.[sortConfig.key]);

    return [...rows].sort((a, b) => {
        const aValue = getValue(a);
        const bValue = getValue(b);

        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1 * direction;
        if (bValue == null) return -1 * direction;

        const aDate = Date.parse(aValue);
        const bDate = Date.parse(bValue);
        const bothDates = !Number.isNaN(aDate) && !Number.isNaN(bDate);
        if (bothDates) return (aDate - bDate) * direction;

        const aNumber = Number(aValue);
        const bNumber = Number(bValue);
        const bothNumbers = !Number.isNaN(aNumber) && !Number.isNaN(bNumber);
        if (bothNumbers) return (aNumber - bNumber) * direction;

        return String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' }) * direction;
    });
};
