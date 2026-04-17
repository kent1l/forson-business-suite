const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

import { useEffect, useMemo, useState } from 'react';

const PaginationControls = ({
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
    className = ''
}) => {
    const totalPages = Math.max(Math.ceil((total || 0) / pageSize), 1);
    const safePage = Math.min(Math.max(page || 1, 1), totalPages);
    const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(safePage * pageSize, total);
    const [jumpPage, setJumpPage] = useState(String(safePage));

    useEffect(() => {
        setJumpPage(String(safePage));
    }, [safePage]);

    const pageButtons = useMemo(() => {
        const spread = 2;
        const from = Math.max(1, safePage - spread);
        const to = Math.min(totalPages, safePage + spread);
        const pages = [];
        for (let i = from; i <= to; i += 1) pages.push(i);
        return pages;
    }, [safePage, totalPages]);

    const handlePageChange = (nextPage) => {
        const clamped = Math.min(Math.max(nextPage, 1), totalPages);
        onPageChange(clamped);
        setJumpPage(String(clamped));
    };

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
                    onClick={() => handlePageChange(safePage - 1)}
                    disabled={safePage <= 1}
                >
                    Previous
                </button>
                <div className="hidden items-center gap-1 md:flex">
                    {pageButtons[0] > 1 && (
                        <>
                            <button type="button" className="rounded-md border border-gray-300 px-2 py-1 text-sm" onClick={() => handlePageChange(1)}>1</button>
                            {pageButtons[0] > 2 && <span className="px-1 text-xs text-gray-500">…</span>}
                        </>
                    )}
                    {pageButtons.map((pageNumber) => (
                        <button
                            key={pageNumber}
                            type="button"
                            className={`rounded-md border px-2 py-1 text-sm ${pageNumber === safePage ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300'}`}
                            onClick={() => handlePageChange(pageNumber)}
                        >
                            {pageNumber}
                        </button>
                    ))}
                    {pageButtons[pageButtons.length - 1] < totalPages && (
                        <>
                            {pageButtons[pageButtons.length - 1] < totalPages - 1 && <span className="px-1 text-xs text-gray-500">…</span>}
                            <button type="button" className="rounded-md border border-gray-300 px-2 py-1 text-sm" onClick={() => handlePageChange(totalPages)}>{totalPages}</button>
                        </>
                    )}
                </div>
                <span className="text-sm text-gray-700">
                    Page {safePage} / {totalPages}
                </span>
                <button
                    type="button"
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => handlePageChange(safePage + 1)}
                    disabled={safePage >= totalPages}
                >
                    Next
                </button>
                <div className="flex items-center gap-1">
                    <label htmlFor="jumpPage" className="text-sm text-gray-600">Jump</label>
                    <input
                        id="jumpPage"
                        type="number"
                        min={1}
                        max={totalPages}
                        value={jumpPage}
                        onChange={(e) => setJumpPage(e.target.value)}
                        className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                    <button
                        type="button"
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                        onClick={() => handlePageChange(Number(jumpPage || safePage))}
                    >
                        Go
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaginationControls;
