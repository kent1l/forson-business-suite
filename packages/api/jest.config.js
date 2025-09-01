module.exports = {
	testEnvironment: 'node',
	testMatch: [
		"**/test/**/*.test.js",
		"**/tests/**/*.test.js"
	],
	testPathIgnorePatterns: [
		"/node_modules/",
		"/tests/.*db_test\\.js$",
		"payment_terms_db_test.js"
	],
	setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
	verbose: false,
	collectCoverage: false
};
