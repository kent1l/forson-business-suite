import api from '../api';

// A confidence-band decision must be made by a person, not inferred from a
// retry. The server evaluates the same payload again before honoring either
// explicit choice, so a stale client cannot bypass a high-confidence match.
export const postWithJevConfirmation = async (endpoint, payload, entityLabel) => {
    try {
        return await api.post(endpoint, payload);
    } catch (error) {
        const body = error.response?.data;
        const candidate = body?.duplicate;
        if (error.response?.status !== 409 || !body?.confirmation_required || !candidate) throw error;

        const confidence = Math.round(Number(candidate.confidence || 0) * 100);
        const useExisting = window.confirm(
            `${body.message}\n\nSuggested ${entityLabel}: ${candidate.display_name} (${confidence}% confidence).\n\nPress OK to use the existing entry, or Cancel to create a separate new entry.`
        );
        return api.post(endpoint, {
            ...payload,
            jev_confirmation: {
                candidate_id: candidate.brand_id || candidate.group_id || candidate.customer_id || candidate.supplier_id || candidate.part_id,
                action: useExisting ? 'use_existing' : 'create_new',
            },
        });
    }
};
