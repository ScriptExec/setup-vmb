import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as platform from "./utils/platform";
import { repository_url } from "./config";

type ActionInputs = {
	version: string;
	github_token: string;
};

async function setup(): Promise<void> {
	const action_inputs = get_action_inputs();
	const platform_name = platform.get_platform_name();
	const resolved_version = await resolve_version(action_inputs, repository_url);
	const download_url = get_download_url(resolved_version, repository_url, platform_name);
	const checksum_url = get_checksum_url(resolved_version, repository_url);
	const archive_path = await tc.downloadTool(download_url);
	const checksum_path = await tc.downloadTool(checksum_url);
	const archive_filename = get_asset_filename(download_url);
	verify_archive_checksum(archive_path, archive_filename, checksum_path);
	const path_to_cli = platform_name === "windows" ? await tc.extractZip(archive_path) : await tc.extractTar(archive_path);
	core.addPath(path_to_cli);
}

function get_action_inputs(): ActionInputs {
	return {
		version: core.getInput("version"),
		github_token: core.getInput("github-token"),
	};
}

async function resolve_version(action_inputs: ActionInputs, repository_url: string): Promise<string> {
	if (action_inputs.version.length > 0 && action_inputs.version !== "latest") {
		return action_inputs.version;
	}

	const repository_path = new URL(repository_url).pathname.replace(/^\/+|\/+$/g, "");
	const [owner, repo] = repository_path.split("/");
	if (!owner || !repo) {
		throw new Error(`Invalid repository URL: ${repository_url}`);
	}

	return await get_latest_release_tag(owner, repo, action_inputs.github_token);
}

async function get_latest_release_tag(owner: string, repo: string, github_token: string): Promise<string> {
	const headers: Record<string, string> = {
		accept: "application/vnd.github+json",
	};

	if (github_token.length > 0) {
		headers.authorization = `Bearer ${github_token}`;
	}

	const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
		headers,
	});

	if (!response.ok) {
		throw new Error(`Failed to resolve latest release for ${owner}/${repo}: ${response.status} ${response.statusText}`);
	}

	const release = (await response.json()) as { tag_name?: string };
	if (!release.tag_name) {
		throw new Error(`Latest release for ${owner}/${repo} did not include a tag name`);
	}

	return release.tag_name;
}

function get_download_url(version: string, repository_url: string, platform_name: string): string {
	const release_version = version;

	if (platform_name === "windows") {
		return `${repository_url}/releases/download/${release_version}/vmb-x86_64-pc-windows-msvc.zip`;
	}

	if (platform_name === "linux" || platform_name === "macos") {
		return `${repository_url}/releases/download/${release_version}/vmb-x86_64-unknown-linux-gnu.tar.xz`;
	}

	throw new Error(`Unsupported platform: ${platform_name}`);
}

function get_checksum_url(version: string, repository_url: string): string {
	return `${repository_url}/releases/download/${version}/sha256.sum`;
}

function get_asset_filename(download_url: string): string {
	const asset_path = new URL(download_url).pathname;
	return path.basename(asset_path);
}

function verify_archive_checksum(archive_path: string, archive_filename: string, checksum_path: string): void {
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

setup().catch((error) => core.setFailed((error as Error).message));
