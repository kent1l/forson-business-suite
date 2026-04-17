const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const parsePaginationQuery = (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || DEFAULT_PAGE, 1);
    const requestedPageSize = parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(Math.max(requestedPageSize, 1), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const paginated = query.paginated === '1' || query.paginated === 'true' || query.paginated === true;

    return {
        page,
        pageSize,
        offset,
        limit: pageSize,
        paginated
    };
};

const buildPaginationMeta = ({ page, pageSize, total }) => ({
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1)
});

const paginatedResponse = ({ data, page, pageSize, total }) => ({
    data,
    ...buildPaginationMeta({ page, pageSize, total })
});

module.exports = {
    DEFAULT_PAGE,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    parsePaginationQuery,
    buildPaginationMeta,
    paginatedResponse
};
