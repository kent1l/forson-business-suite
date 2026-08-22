import { useEffect, useState } from 'react';
import { evaluateMathExpression } from '../../lib/mathExpression';

const roundTo = (value, precision) => {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
};

/**
 * Drop-in replacement for a numeric <input> that also accepts arithmetic
 * expressions (e.g. "5*2", "1000/3"). The expression is evaluated and
 * committed (calling onChange with the resulting number) on blur or Enter;
 * invalid expressions revert the field to the last valid value.
 */
const MathExpressionInput = ({
    value,
    onChange,
    precision = 6,
    className = '',
    placeholder,
    disabled,
    min,
    max,
    onFocus,
    ...rest
}) => {
    const [draft, setDraft] = useState(String(value ?? ''));

    useEffect(() => {
        setDraft(String(value ?? ''));
    }, [value]);

    const handleFocus = (e) => {
        e.target.select();
        if (onFocus) onFocus(e);
    };

    const handleChange = (e) => {
        setDraft(e.target.value);
    };

    const commit = () => {
        const result = evaluateMathExpression(draft);
        if (result === null) {
            setDraft(String(value ?? ''));
            return;
        }
        let rounded = roundTo(result, precision);
        if (typeof min === 'number') rounded = Math.max(min, rounded);
        if (typeof max === 'number') rounded = Math.min(max, rounded);
        setDraft(String(rounded));
        if (rounded !== value) {
            onChange(rounded);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={handleChange}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            className={className}
            placeholder={placeholder}
            disabled={disabled}
            {...rest}
        />
    );
};

export default MathExpressionInput;
