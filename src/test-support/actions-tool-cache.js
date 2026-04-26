module.exports = {
	downloadTool: async () => {
		throw new Error("downloadTool should not be called in tests");
	},
	extractZip: async () => {
		throw new Error("extractZip should not be called in tests");
	},
	extractTar: async () => {
		throw new Error("extractTar should not be called in tests");
	},
};
