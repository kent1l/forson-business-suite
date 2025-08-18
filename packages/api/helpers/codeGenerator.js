/**
 * Generates a unique, 4-character code for a new entity (like a brand or group)
 * based on a set of specific naming rules. It attempts to create a mnemonic code
 * first and then falls back to a numeric suffix to resolve conflicts.
 *
 * @param {object} client - The database client to use for checking uniqueness.
 * @param {string} name - The full name of the entity (e.g., "Bosch", "Brake Pads").
 * @param {string} table - The database table to check against (e.g., "brand").
 * @param {string} column - The column that must be unique (e.g., "brand_code").
 * @returns {Promise<string>} A promise that resolves to a unique 4-character code.
 */
const generateUniqueCode = async (client, name, table, column) => {
    const RESERVED_CODES = ['NULL', 'TEST', 'XXXX'];
    const GENERIC_WORDS = ['PARTS', 'COMPANY', 'CORP', 'CO', 'INC', 'LTD', 'CORPORATION'];

    // 1. Helper to generate the ideal 4-character base code from a name.
    const generateBaseCode = (inputName) => {
        if (!inputName || typeof inputName !== 'string') {
            return 'XXXX';
        }

        const cleanedName = inputName.toUpperCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '');
        const words = cleanedName.split(/\s+/).filter(Boolean);
        const significantWords = words.filter(word => !GENERIC_WORDS.includes(word));

        let code = '';

        if (significantWords.length === 0) {
            // If only generic words, use the first one. e.g., "Parts Company" -> "PART"
            code = words.length > 0 ? words[0].substring(0, 4) : '';
        } else if (significantWords.length === 1) {
            // Single-word names: Take the first 4 letters. e.g., "Radiator" -> "RADI"
            code = significantWords[0].substring(0, 4);
        } else if (significantWords.length === 2) {
            // Two-word names: Take the first 2 letters of each word. e.g., "Brake Pads" -> "BRPA"
            code = significantWords[0].substring(0, 2) + significantWords[1].substring(0, 2);
        } else { // 3 or more words
            // Three-or-more-word names: First letter of the first two words, first two letters of the third word.
            // e.g., "Front Brake Pads" -> "FBPA"
            code = significantWords[0].substring(0, 1) +
                   significantWords[1].substring(0, 1) +
                   significantWords[2].substring(0, 2);
        }

        // Ensure the code is exactly 4 characters, padding with 'X' if necessary.
        return code.padEnd(4, 'X').substring(0, 4);
    };

    // 2. Check if a given code is available in the database.
    const isCodeAvailable = async (code) => {
        if (RESERVED_CODES.includes(code)) {
            return false;
        }
        const res = await client.query(`SELECT 1 FROM "${table}" WHERE ${column} = $1`, [code]);
        return res.rows.length === 0;
    };

    // 3. Main Logic: Generate, check, and resolve conflicts.
    const baseCode = generateBaseCode(name);

    if (await isCodeAvailable(baseCode)) {
        return baseCode;
    }

    // 4. Conflict Resolution: Keep the first 2-3 letters and append a number.
    let counter = 1;
    const prefix = baseCode.substring(0, 3);

    while (true) {
        // This loop will eventually find a unique code, e.g., BOS1, BOS2...
        const nextCode = prefix + counter;
        if (nextCode.length <= 10 && await isCodeAvailable(nextCode)) { // Limit code length
            return nextCode;
        }
        counter++;
        // Failsafe to prevent infinite loops in extreme edge cases.
        if (counter > 999) {
            throw new Error(`Could not generate a unique code for "${name}"`);
        }
    }
};

module.exports = { generateUniqueCode };