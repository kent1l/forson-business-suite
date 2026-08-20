import { useEffect, useRef } from 'react';

/**
 * Applies a navigation payload to a page's local state, once per navigation.
 *
 * Navigation in this app is `onNavigate(pageKey, state)`, and the state lands on
 * the target page as `pageState`. A lazy `useState` initialiser is not enough to
 * consume it: MainLayout only swaps the rendered page when the page *key*
 * changes, so clicking a second A/P notification while already on the A/P page
 * leaves the component mounted and the initialiser never runs again.
 *
 * Keying on the payload object's identity instead makes each navigation apply
 * exactly once — including a repeat navigation to the page you are already
 * looking at — while leaving the user free to change tabs afterwards without the
 * deep link snapping them back.
 */
const useDeepLink = (pageState, apply) => {
    const appliedRef = useRef(null);
    // Read `apply` through a ref so a caller passing an inline arrow (the normal
    // case) doesn't need useCallback to avoid re-running this effect.
    const applyRef = useRef(apply);
    applyRef.current = apply;

    useEffect(() => {
        if (!pageState || appliedRef.current === pageState) return;
        appliedRef.current = pageState;
        applyRef.current(pageState);
    }, [pageState]);
};

export default useDeepLink;
