/**
 * Copies a given text string to the system clipboard.
 * Supports modern navigator.clipboard with fallback to document.execCommand.
 *
 * @param {string|number} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
    if (text === null || text === undefined || text === '') {
        return false;
    }
    const str = String(text);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(str);
            return true;
        } catch {
            // Fall back to execCommand if navigator.clipboard throws (e.g. permission denied)
        }
    }
    if (typeof document !== 'undefined' && document.createElement) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = str;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return Boolean(success);
        } catch {
            return false;
        }
    }
    return false;
}
