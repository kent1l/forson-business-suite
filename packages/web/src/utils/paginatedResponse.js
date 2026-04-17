export const getPaginatedPayload = (payload, fallbackTotal = 0) => {
    if (Array.isArray(payload)) {
        return {
            data: payload,
            total: fallbackTotal || payload.length,
            page: 1,
            pageSize: payload.length || 1
        };
    }

    return {
        data: payload?.data || payload?.details || [],
        total: Number(payload?.total ?? fallbackTotal ?? 0),
        page: Number(payload?.page ?? 1),
        pageSize: Number(payload?.pageSize ?? (payload?.data?.length || payload?.details?.length || 1))
    };
};
