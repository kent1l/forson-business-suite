function chunkToWords(value) {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

    let n = value;
    const out = [];

    if (n >= 100) {
        out.push(`${ones[Math.floor(n / 100)]} hundred`);
        n %= 100;
    }

    if (n >= 20) {
        out.push(tens[Math.floor(n / 10)]);
        n %= 10;
    } else if (n >= 10) {
        out.push(teens[n - 10]);
        n = 0;
    }

    if (n > 0) out.push(ones[n]);
    return out.join(' ').trim();
}

function amountToWords(amount, options = {}) {
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount < 0) {
        throw new Error('Amount must be a non-negative number');
    }
    const suffix = String(options.suffix || 'pesos').trim();

    const rounded = Math.round(numericAmount * 100) / 100;
    const whole = Math.floor(rounded);
    const cents = Math.round((rounded - whole) * 100);

    if (whole === 0 && cents === 0) return suffix ? `zero ${suffix}` : 'zero';
    if (whole === 0) return suffix ? `zero ${suffix} and ${String(cents).padStart(2, '0')}/100` : `zero and ${String(cents).padStart(2, '0')}/100`;

    const parts = [];
    const billions = Math.floor(whole / 1_000_000_000);
    const millions = Math.floor((whole % 1_000_000_000) / 1_000_000);
    const thousands = Math.floor((whole % 1_000_000) / 1_000);
    const remainder = whole % 1_000;

    if (billions) parts.push(`${chunkToWords(billions)} billion`);
    if (millions) parts.push(`${chunkToWords(millions)} million`);
    if (thousands) parts.push(`${chunkToWords(thousands)} thousand`);
    if (remainder) parts.push(chunkToWords(remainder));

    const base = suffix ? `${parts.join(' ')} ${suffix}`.trim() : parts.join(' ');
    if (cents === 0) return base;
    return `${base} and ${String(cents).padStart(2, '0')}/100`.trim();
}

module.exports = { amountToWords };
