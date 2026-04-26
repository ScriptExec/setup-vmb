import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { repository_url } from "./config";
import {
	get_asset_filename,
	get_checksum_url,
	get_download_url,
	get_latest_release_tag,
	resolve_version,
	verify_archive_checksum,
} from "./index";
import { get_platform_name } from "./utils/platform";

const live_download_test = process.env.RUN_LIVE_DOWNLOAD_TESTS === "1" ? it : it.skip;

async function fetch_json<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			accept: "application/vnd.github+json",
			...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return (await response.json()) as T;
}

async function fetch_text(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			accept: "application/octet-stream",
			...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return await response.text();
}

describe("get_download_url", () => {
	it("builds the windows download URL", () => {
		expect(get_download_url("v1.0.0", "https://github.com/ScriptExec/vmb", "windows")).toBe(
			"https://github.com/ScriptExec/vmb/releases/download/v1.0.0/vmb-x86_64-pc-windows-msvc.zip",
		);
	});

	it("builds the linux download URL", () => {
		expect(get_download_url("v1.0.0", "https://github.com/ScriptExec/vmb", "linux")).toBe(
			"https://github.com/ScriptExec/vmb/releases/download/v1.0.0/vmb-x86_64-unknown-linux-gnu.tar.xz",
		);
	});
});

describe("get_checksum_url", () => {
	it("builds the checksum URL", () => {
		expect(get_checksum_url("v1.0.0", "https://github.com/ScriptExec/vmb")).toBe(
			"https://github.com/ScriptExec/vmb/releases/download/v1.0.0/sha256.sum",
		);
	});
});

describe("get_asset_filename", () => {
	it("returns the basename of the download URL", () => {
		expect(
			get_asset_filename("https://github.com/ScriptExec/vmb/releases/download/v1.0.0/vmb-x86_64-pc-windows-msvc.zip"),
		).toBe("vmb-x86_64-pc-windows-msvc.zip");
	});
});

describe("resolve_version", () => {
	it("returns an explicit version unchanged", async () => {
		await expect(resolve_version({ version: "v1.0.0", github_token: "" }, "https://github.com/ScriptExec/vmb")).resolves.toBe(
			"v1.0.0",
		);
	});

	it("uses the latest release tag when version is latest", async () => {
		const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ tag_name: "v9.9.9" }),
		} as Response);

		await expect(resolve_version({ version: "latest", github_token: "token-123" }, "https://github.com/ScriptExec/vmb")).resolves.toBe(
			"v9.9.9",
		);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.github.com/repos/ScriptExec/vmb/releases/latest",
			expect.objectContaining({
				headers: expect.objectContaining({
					accept: "application/vnd.github+json",
					authorization: "Bearer token-123",
				}),
			}),
		);

		fetchSpy.mockRestore();
	});
});

describe("get_latest_release_tag", () => {
	it("rejects failed API responses", async () => {
		const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
			json: async () => ({}),
		} as Response);

		await expect(get_latest_release_tag("ScriptExec", "vmb", "")).rejects.toThrow(
			"Failed to resolve latest release for ScriptExec/vmb: 404 Not Found",
		);

		fetchSpy.mockRestore();
	});
});

describe("verify_archive_checksum", () => {
	it("accepts a matching checksum", () => {
		const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-vmb-"));
		const archive_path = path.join(temp_dir, "archive.zip");
		const checksum_path = path.join(temp_dir, "sha256.sum");
		const archive_content = Buffer.from("archive payload");
		fs.writeFileSync(archive_path, archive_content);

		const checksum = crypto.createHash("sha256").update(archive_content).digest("hex");
		fs.writeFileSync(checksum_path, `${checksum} *archive.zip\n`);

		expect(() => verify_archive_checksum(archive_path, "archive.zip", checksum_path)).not.toThrow();
	});

	it("rejects a missing checksum entry", () => {
		const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-vmb-"));
		const archive_path = path.join(temp_dir, "archive.zip");
		const checksum_path = path.join(temp_dir, "sha256.sum");
		fs.writeFileSync(archive_path, "archive payload");
		fs.writeFileSync(checksum_path, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff *other.zip\n");

		expect(() => verify_archive_checksum(archive_path, "archive.zip", checksum_path)).toThrow(
			"Checksum entry for archive.zip not found in sha256.sum",
		);
	});

	it("rejects a checksum mismatch", () => {
		const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-vmb-"));
		const archive_path = path.join(temp_dir, "archive.zip");
		const checksum_path = path.join(temp_dir, "sha256.sum");
		fs.writeFileSync(archive_path, "archive payload");
		fs.writeFileSync(checksum_path, `${"0".repeat(64)} *archive.zip\n`);

		expect(() => verify_archive_checksum(archive_path, "archive.zip", checksum_path)).toThrow(
			"Checksum verification failed for archive.zip",
		);
	});
});

describe("live release download", () => {
	live_download_test("downloads and verifies the latest release artifact", async () => {
		const platform_name = get_platform_name();
		if (platform_name === "unknown") {
			throw new Error("Unsupported platform for live release download test");
		}

		const release = await fetch_json<{ tag_name: string }>("https://api.github.com/repos/ScriptExec/vmb/releases/latest");
		const download_url = get_download_url(release.tag_name, repository_url, platform_name);
		const checksum_url = get_checksum_url(release.tag_name, repository_url);
		const archive_filename = get_asset_filename(download_url);

		const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-vmb-live-"));
		const archive_path = path.join(temp_dir, archive_filename);
		const checksum_path = path.join(temp_dir, "sha256.sum");

		const archive_content = await fetch(download_url);
		if (!archive_content.ok) {
			throw new Error(`Failed to download archive ${download_url}: ${archive_content.status} ${archive_content.statusText}`);
		}

		const checksum_content = await fetch_text(checksum_url);
		fs.writeFileSync(archive_path, Buffer.from(await archive_content.arrayBuffer()));
		fs.writeFileSync(checksum_path, checksum_content);

		expect(() => verify_archive_checksum(archive_path, archive_filename, checksum_path)).not.toThrow();
	});
});
