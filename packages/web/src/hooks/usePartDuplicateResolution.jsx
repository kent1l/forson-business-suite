import { useState, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import PartDuplicateModal from '../components/parts/PartDuplicateModal';

/**
 * Hook providing unified duplicate resolution for part creation across all entry points.
 * Returns:
 * - executePartSave: async ({ endpoint, payload, brands, groups }) => { outcome: 'created'|'existing'|'cancelled'|'error', part, error }
 * - DuplicateDialog: React component to render in the caller's tree
 * - isResolving: boolean flag indicating if save or resolution is in flight
 */
export const usePartDuplicateResolution = () => {
    const [dialogState, setDialogState] = useState({
        isOpen: false,
        candidate: null,
        submitted: null,
        decisionToken: null,
        isSubmitting: false,
    });

    const resolverRef = useRef(null);
    const inFlightRef = useRef(false);

    const resolveAction = useCallback((action) => {
        if (resolverRef.current) {
            const resolve = resolverRef.current;
            resolverRef.current = null;
            resolve(action);
        }
    }, []);

    const executePartSave = useCallback(async ({
        endpoint = '/parts',
        payload,
        brands = [],
        groups = [],
    }) => {
        if (inFlightRef.current) return { outcome: 'cancelled' };
        inFlightRef.current = true;

        const resolveBrandName = (brandId) => {
            if (!brandId) return '';
            const b = brands.find(item => Number(item.brand_id) === Number(brandId));
            return b ? b.brand_name : '';
        };

        const resolveGroupName = (groupId) => {
            if (!groupId) return '';
            const g = groups.find(item => Number(item.group_id) === Number(groupId));
            return g ? g.group_name : '';
        };

        const submitted = {
            ...payload,
            brand_name: payload.brand_name || resolveBrandName(payload.brand_id),
            group_name: payload.group_name || resolveGroupName(payload.group_id),
        };

        try {
            // First attempt: POST without confirmation
            const res = await api.post(endpoint, payload);
            inFlightRef.current = false;
            const isExisting = res.status === 200 || res.data?.existing || res.data?.catalog_resolution === 'existing';
            return {
                outcome: isExisting ? 'existing' : 'created',
                part: res.data,
            };
        } catch (firstErr) {
            const data = firstErr.response?.data;
            if (firstErr.response?.status !== 409 || !data?.duplicate_resolution_required || !data?.duplicate) {
                inFlightRef.current = false;
                const errMsg = data?.error || data?.message || 'Failed to save part.';
                toast.error(errMsg);
                return { outcome: 'error', error: firstErr };
            }

            // HTTP 409 duplicate decision required: prompt user via dialog
            let currentCandidate = data.duplicate;
            let currentDecisionToken = data.decision_token;
            let retryCount = 0;

            while (retryCount < 2) {
                retryCount++;
                const userChoice = await new Promise((resolve) => {
                    resolverRef.current = resolve;
                    setDialogState({
                        isOpen: true,
                        candidate: currentCandidate,
                        submitted,
                        decisionToken: currentDecisionToken,
                        isSubmitting: false,
                    });
                });

                if (userChoice === 'cancel' || !userChoice) {
                    setDialogState(prev => ({ ...prev, isOpen: false }));
                    inFlightRef.current = false;
                    return { outcome: 'cancelled' };
                }

                // Operator chose 'use_existing' or 'create_new'
                setDialogState(prev => ({ ...prev, isSubmitting: true }));
                try {
                    const confirmPayload = {
                        ...payload,
                        jev_confirmation: {
                            candidate_id: currentCandidate.part_id,
                            action: userChoice,
                            decision_token: currentDecisionToken,
                        },
                    };
                    const retryRes = await api.post(endpoint, confirmPayload);
                    setDialogState(prev => ({ ...prev, isOpen: false, isSubmitting: false }));
                    inFlightRef.current = false;

                    const isExisting = userChoice === 'use_existing' || retryRes.status === 200 || retryRes.data?.existing || retryRes.data?.catalog_resolution === 'existing';
                    return {
                        outcome: isExisting ? 'existing' : 'created',
                        part: retryRes.data,
                    };
                } catch (retryErr) {
                    const retryData = retryErr.response?.data;
                    if (retryErr.response?.status === 409 && retryData?.duplicate_resolution_required && retryData?.duplicate) {
                        // Stale decision or re-evaluated candidate: refresh review state
                        currentCandidate = retryData.duplicate;
                        currentDecisionToken = retryData.decision_token;
                        setDialogState(prev => ({
                            ...prev,
                            candidate: currentCandidate,
                            decisionToken: currentDecisionToken,
                            isSubmitting: false,
                        }));
                        continue;
                    }

                    // Network or database constraint error (e.g. duplicate barcode)
                    setDialogState(prev => ({ ...prev, isOpen: false, isSubmitting: false }));
                    inFlightRef.current = false;
                    const msg = retryData?.error || retryData?.message || 'Failed to save part.';
                    toast.error(msg);
                    return { outcome: 'error', error: retryErr };
                }
            }

            setDialogState(prev => ({ ...prev, isOpen: false, isSubmitting: false }));
            inFlightRef.current = false;
            return { outcome: 'cancelled' };
        }
    }, []);

    const DuplicateDialog = useCallback(() => (
        <PartDuplicateModal
            isOpen={dialogState.isOpen}
            candidate={dialogState.candidate}
            submitted={dialogState.submitted}
            isSubmitting={dialogState.isSubmitting}
            onResolve={resolveAction}
        />
    ), [dialogState, resolveAction]);

    return {
        executePartSave,
        DuplicateDialog,
        isResolving: dialogState.isOpen || dialogState.isSubmitting,
    };
};

export default usePartDuplicateResolution;
