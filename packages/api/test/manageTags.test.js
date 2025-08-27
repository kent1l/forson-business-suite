const { Client } = require('pg');
const { manageTags } = require('../routes/partRoutes');
jest.mock('meilisearch');

jest.mock('pg', () => {
    const mClient = {
        query: jest.fn(),
        connect: jest.fn(),
        end: jest.fn(),
    };
    const mPool = {
        connect: jest.fn(() => mClient),
        query: jest.fn(),
        end: jest.fn(),
    };
    return { Client: jest.fn(() => mClient), Pool: jest.fn(() => mPool) };
});

describe('manageTags', () => {
    let client;

    beforeEach(() => {
        client = new Client();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should delete existing tags and insert new ones', async () => {
        client.query.mockResolvedValueOnce({ rows: [] }); // For DELETE query
        client.query.mockResolvedValueOnce({ rows: [] }); // For SELECT query
        client.query.mockResolvedValueOnce({ rows: [{ tag_id: 1, tag_name: 'new-tag' }] }); // For INSERT query
        client.query.mockResolvedValueOnce({}); // For INSERT INTO part_tag

        const tags = ['new-tag'];
        const partId = 1;

        await manageTags(client, tags, partId);

        expect(client.query).toHaveBeenCalledWith('DELETE FROM part_tag WHERE part_id = $1', [partId]);
        expect(client.query).toHaveBeenCalledWith(
            'SELECT tag_id, tag_name FROM tag WHERE tag_name = ANY($1)',
            [['new-tag']]
        );
        expect(client.query).toHaveBeenCalledWith(
            'INSERT INTO tag (tag_name) VALUES ($1) RETURNING tag_id, tag_name',
            ['new-tag']
        );
        expect(client.query).toHaveBeenCalledWith(
            'INSERT INTO part_tag (part_id, tag_id) VALUES (1, 1) ON CONFLICT DO NOTHING'
        );
    });

    it('should handle existing tags correctly', async () => {
        client.query.mockResolvedValueOnce({ rows: [] }); // For DELETE query
        client.query.mockResolvedValueOnce({ rows: [{ tag_id: 1, tag_name: 'existing-tag' }] }); // For SELECT query
        client.query.mockResolvedValueOnce({}); // For INSERT INTO part_tag

        const tags = ['existing-tag'];
        const partId = 1;

        await manageTags(client, tags, partId);

        expect(client.query).toHaveBeenCalledWith('DELETE FROM part_tag WHERE part_id = $1', [partId]);
        expect(client.query).toHaveBeenCalledWith(
            'SELECT tag_id, tag_name FROM tag WHERE tag_name = ANY($1)',
            [['existing-tag']]
        );
        expect(client.query).toHaveBeenCalledWith(
            'INSERT INTO part_tag (part_id, tag_id) VALUES (1, 1) ON CONFLICT DO NOTHING'
        );
    });
});
