const express = require('express');
const { meiliClient } = require('../meilisearch');
const router = express.Router();

// GET /api/power-search/parts - Advanced multi-filter search using Meilisearch
router.get('/power-search/parts', async (req, res) => {
    const { keyword, brand, group, application, year } = req.query;

    try {
        const index = meiliClient.index('parts');
        const searchOptions = {
            limit: 50, // Limit the number of results
            attributesToHighlight: ['display_name', 'applications'],
            highlightPreTag: '<strong>',
            highlightPostTag: '</strong>',
        };

        const searchResults = await index.search(keyword || '', searchOptions);

        res.json(searchResults.hits);
    } catch (err) {
        console.error('Meilisearch Error:', err.message);
        res.status(500).send('Server Error during search.');
    }
});

module.exports = router;