/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/*.test.ts"],
	roots: ["<rootDir>/src"],
	clearMocks: true,
	moduleNameMapper: {
		"^@actions/core$": "<rootDir>/src/test-support/actions-core.js",
		"^@actions/tool-cache$": "<rootDir>/src/test-support/actions-tool-cache.js",
	},
};
