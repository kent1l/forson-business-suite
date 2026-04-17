const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const PaginationControls = ({
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
    className = ''
}) => {
    const totalPages = Math.max(Math.ceil((total || 0) / pageSize), 1);
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(page * pageSize, total);

    return (
        <div className={`mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
            <div className="text-sm text-gray-600">
                Showing {start}-{end} of {total} items
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="pageSize" className="text-sm text-gray-600">Rows per page</label>
                <select
                    id="pageSize"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={pageSize}
                    onChange={(e) => onPageSizeChange(Number(e.target.value))}
                >
                    {PAGE_SIZE_OPTIONS.map(size => (
                        <option key={size} value={size}>{size}</option>
                    ))}
                </select>
                <button
                    type="button"
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1}
                >
                    Previous
                </button>
                <span className="text-sm text-gray-700">
                    Page {page} / {totalPages}
                </span>
                <button
                    type="button"
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                >
                    Next
                </button>
            </div>
        </div>
    );
};

export default PaginationControls;
