// Prevent real MeiliSearch calls during tests
jest.mock('./meilisearch', () => {
	return {
		meiliClient: { index: () => ({ search: jest.fn().mockResolvedValue({ hits: [] }) }) },
		syncPartWithMeili: jest.fn(),
		removePartFromMeili: jest.fn(),
	};
});

// Provide safe defaults for DB env to avoid pg trying socket defaults in some envs
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';
