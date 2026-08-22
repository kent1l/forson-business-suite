const ALLOWED_CHARS = /^[0-9+\-*/().\s]+$/;

class ParseError extends Error {}

function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            let num = ch;
            i += 1;
            while (i < input.length && /[0-9.]/.test(input[i])) {
                num += input[i];
                i += 1;
            }
            if ((num.match(/\./g) || []).length > 1) throw new ParseError('Invalid number');
            tokens.push({ type: 'number', value: parseFloat(num) });
            continue;
        }
        if ('+-*/()'.includes(ch)) {
            tokens.push({ type: ch });
            i += 1;
            continue;
        }
        throw new ParseError(`Unexpected character: ${ch}`);
    }
    return tokens;
}

function createParser(tokens) {
    let pos = 0;

    function peek() {
        return tokens[pos];
    }

    function consume(type) {
        const token = tokens[pos];
        if (!token || token.type !== type) {
            throw new ParseError(`Expected ${type}`);
        }
        pos += 1;
        return token;
    }

    function parseExpression() {
        let value = parseTerm();
        while (peek() && (peek().type === '+' || peek().type === '-')) {
            const op = consume(peek().type).type;
            const rhs = parseTerm();
            value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
    }

    function parseTerm() {
        let value = parseUnary();
        while (peek() && (peek().type === '*' || peek().type === '/')) {
            const op = consume(peek().type).type;
            const rhs = parseUnary();
            if (op === '*') {
                value *= rhs;
            } else {
                if (rhs === 0) throw new ParseError('Division by zero');
                value /= rhs;
            }
        }
        return value;
    }

    function parseUnary() {
        if (peek() && peek().type === '-') {
            consume('-');
            return -parseUnary();
        }
        if (peek() && peek().type === '+') {
            consume('+');
            return parseUnary();
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const token = peek();
        if (!token) throw new ParseError('Unexpected end of expression');
        if (token.type === 'number') {
            pos += 1;
            return token.value;
        }
        if (token.type === '(') {
            consume('(');
            const value = parseExpression();
            consume(')');
            return value;
        }
        throw new ParseError(`Unexpected token: ${token.type}`);
    }

    return {
        parseAndConsumeAll() {
            const value = parseExpression();
            if (pos !== tokens.length) {
                throw new ParseError('Unexpected trailing input');
            }
            return value;
        },
    };
}

/**
 * Safely evaluates a simple arithmetic expression (+, -, *, /, parentheses,
 * decimals) without eval()/Function(). Returns the numeric result, or null
 * if the input is empty, malformed, or divides by zero.
 */
export function evaluateMathExpression(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed === '') return null;
    if (!ALLOWED_CHARS.test(trimmed)) return null;

    try {
        const tokens = tokenize(trimmed);
        if (tokens.length === 0) return null;
        const parser = createParser(tokens);
        const result = parser.parseAndConsumeAll();
        return Number.isFinite(result) ? result : null;
    } catch {
        return null;
    }
}
