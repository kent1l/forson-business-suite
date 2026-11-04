import { getEngineCodeDisplay } from '../../utils/engineCodeDisplay.js';

/** Accessible engine-code label for single engines and already scoped lists. */
export default function EngineCodeText({ codes, className = '' }) {
    const display = getEngineCodeDisplay(codes);
    if (!display.text) return null;
    return (
        <span title={display.full} className={className}>
            <span aria-hidden="true">{display.text}</span>
            <span className="sr-only">{display.full}</span>
        </span>
    );
}
