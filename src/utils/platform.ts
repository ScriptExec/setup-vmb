declare const process: {
	platform: string;
};

export type PlatformName = "windows" | "linux" | "macos" | "unknown";

export function get_platform_name(): PlatformName {
	if (process.platform === "win32") {
		return "windows";
	}

	if (process.platform === "linux") {
		return "linux";
	}

	if (process.platform === "darwin") {
		return "macos";
	}

	return "unknown";
}
