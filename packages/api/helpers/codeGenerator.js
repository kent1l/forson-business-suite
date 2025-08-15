/**
 * Generates a unique, short code for a new entity (like a brand or group).
 * It starts with a 3-character base and appends a number if a collision occurs.
 * @param {object} client - The database client to use for checking uniqueness.
 * @param {string} name - The full name of the entity (e.g., "Bosch").
 * @param {string} table - The database table to check against (e.g., "brand").
 * @param {string} column - The column that must be unique (e.g., "brand_code").
 * @returns {Promise<string>} A promise that resolves to a unique code.
 */
const generateUniqueCode = async (client, name, table, column) => {
    // Create a base code from the first 3 letters of the name.
    const baseCode = name.substring(0, 3).toUpperCase();
    let finalCode = baseCode;
    let counter = 1;

    // Loop until a unique code is found.
    while (true) {
        const res = await client.query(`SELECT 1 FROM "${table}" WHERE ${column} = $1`, [finalCode]);
        // If no rows are returned, the code is unique.
        if (res.rows.length === 0) {
            return finalCode;
        }
        // If a collision is found, append a number and try again.
        finalCode = `${baseCode}${counter}`;
        counter++;
    }
};

module.exports = { generateUniqueCode };
