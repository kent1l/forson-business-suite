const getNextDocumentNumber = async (client, prefix) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // 01 for January
    const period = `${year}${month}`; // Format: YYYYMM

    let nextSeqNum = 1;

    // Lock the row for this prefix and period to prevent race conditions
    const seqRes = await client.query(
        'SELECT last_number FROM document_sequence WHERE prefix = $1 AND period = $2 FOR UPDATE',
        [prefix, period]
    );

    if (seqRes.rows.length > 0) {
        // If a sequence for this month exists, increment it
        nextSeqNum = seqRes.rows[0].last_number + 1;
        await client.query(
            'UPDATE document_sequence SET last_number = $1 WHERE prefix = $2 AND period = $3',
            [nextSeqNum, prefix, period]
        );
    } else {
        // Otherwise, start a new sequence for this month
        await client.query(
            'INSERT INTO document_sequence (prefix, period, last_number) VALUES ($1, $2, $3)',
            [prefix, period, nextSeqNum]
        );
    }

    // Format the number with leading zeros (e.g., 0001)
    const formattedSeqNum = String(nextSeqNum).padStart(4, '0');

    return `${prefix}-${period}-${formattedSeqNum}`; // Final format: GRN-202508-0001
};

module.exports = { getNextDocumentNumber };
