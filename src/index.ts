import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as platform from "./utils/platform";
import { repository_url } from "./config";
import { resolve_version, type ActionInputs } from "./github";
import { PlatformName } from "./utils/platform";

export { resolve_version, get_latest_release_tag } from "./github";

async function setup(): Promise<void> {
	const action_inputs = get_action_inputs();
	const platform_name = platform.get_platform_name();
	const resolved_version = await resolve_version(action_inputs, repository_url);
	const cached_path = tc.find("vmb", resolved_version, process.arch);
	if (cached_path) {
		core.info(`Cache hit for vmb ${resolved_version}: ${cached_path}`);
		core.addPath(cached_path);
		core.info(`Added ${cached_path} to PATH`);
		return;
	}

	core.info(`Cache miss for vmb ${resolved_version}; downloading release assets`);
	const download_url = get_download_url(resolved_version, repository_url, platform_name);
	const checksum_url = get_checksum_url(resolved_version, repository_url);
	core.info(`Resolving vmb ${resolved_version} for ${platform_name}/${process.arch}`);
	core.info(`Downloading archive: ${download_url}`);
	const archive_path = await tc.downloadTool(download_url);
	core.info(`Downloading checksum: ${checksum_url}`);
	const checksum_path = await tc.downloadTool(checksum_url);
	const archive_filename = get_asset_filename(download_url);
	verify_archive_checksum(archive_path, archive_filename, checksum_path);
	core.info(`Checksum verified for ${archive_filename}`);
	let is_windows = platform_name === "windows";

	const extracted_path = !is_windows ? await tc.extractTar(archive_path, undefined, "xJ") : await tc.extractZip(archive_path);
	core.info(`Extracted vmb archive to ${extracted_path}`);

	const vmb_files = find_vmb_files(extracted_path);
	core.info(`Found ${vmb_files.length} vmb executable file(s): ${vmb_files.map((file) => path.basename(file)).join(", ")}`);
	const cli_path = stage_vmb_files(vmb_files);
	core.info(`Prepared CLI directory ${cli_path}`);

	const cached_cli_path = await tc.cacheDir(cli_path, "vmb", resolved_version, process.arch);
	core.info(`Cached CLI directory ${cached_cli_path}`);
	core.addPath(cached_cli_path);
	core.info(`Added ${cached_cli_path} to PATH`);
}

function find_vmb_files(root: string): string[] {
	const matches: string[] = [];
	const vmb_name_pattern = /^vmb(\..+)?$/i;
	const entries = fs.readdirSync(root, { withFileTypes: true });

	for (const entry of entries) {
		const full = path.join(root, entry.name);

		if (entry.isFile() && vmb_name_pattern.test(entry.name)) {
			matches.push(full);
		}

		if (entry.isDirectory()) {
			matches.push(...find_vmb_files(full));
		}
	}

	if (matches.length === 0) {
		throw new Error(`No vmb executable files found in extracted archive at ${root}`);
	}

	return matches;
}

function stage_vmb_files(files: string[]): string {
	const staging_dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "setup-vmb-"));

	for (const source of files) {
		const destination = path.join(staging_dir, path.basename(source));
		fs.copyFileSync(source, destination);
		const mode = fs.statSync(source).mode;
		fs.chmodSync(destination, mode);
	}

	return staging_dir;
}

function get_action_inputs(): ActionInputs {
	return {
		version: core.getInput("version"),
		github_token: core.getInput("github-token"),
	};
}

export function get_download_url(version: string, repository_url: string, platform_name: PlatformName): string {
	const release_version = version;

	if (platform_name === "windows") {
		return `${repository_url}/releases/download/${release_version}/vmb-x86_64-pc-windows-msvc.zip`;
	}

	if (platform_name === "linux" || platform_name === "macos") {
		return `${repository_url}/releases/download/${release_version}/vmb-x86_64-unknown-linux-gnu.tar.xz`;
	}

	throw new Error(`Unsupported platform: ${platform_name}`);
}

export function get_checksum_url(version: string, repository_url: string): string {
	return `${repository_url}/releases/download/${version}/sha256.sum`;
}

export function get_asset_filename(download_url: string): string {
	const asset_path = new URL(download_url).pathname;
	return path.basename(asset_path);
}

export function verify_archive_checksum(archive_path: string, archive_filename: string, checksum_path: string): void {
	const checksum_content = fs.readFileSync(checksum_path, "utf8");
	const lines = checksum_content.split(/\r?\n/);

	let expected_checksum: string | undefined;
	for (const line of lines) {
		const match = line.match(/^([A-Fa-f0-9]{64})\s+\*?(.+)$/);
		const checksum_value = match?.[1];
		const checksum_file = match?.[2];
		if (checksum_value && checksum_file && checksum_file.trim() === archive_filename) {
			expected_checksum = checksum_value.toLowerCase();
			break;
		}
	}

	if (!expected_checksum) {
		throw new Error(`Checksum entry for ${archive_filename} not found in sha256.sum`);
	}

	const archive_data = fs.readFileSync(archive_path);
	const actual_checksum = crypto.createHash("sha256").update(archive_data).digest("hex").toLowerCase();
	if (actual_checksum !== expected_checksum) {
		throw new Error(`Checksum verification failed for ${archive_filename}`);
	}
}

if (process.env.GITHUB_ACTIONS === "true" || require.main === module) {
	void setup().catch((error) => core.setFailed((error as Error).message));
}
