export function getSaleErrorMessage(error, fallback) {
    const data = error?.response?.data;
    for (const message of [data?.message, data?.error]) {
        if (typeof message === 'string' && message.trim()) return message;
    }
    // Request interceptors can reject a sale before it reaches the server.
    if (!error?.response && !error?.isAxiosError && error?.message) return error.message;
    return fallback;
}
