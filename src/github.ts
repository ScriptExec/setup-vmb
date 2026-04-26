export type ActionInputs = {
	version: string;
	github_token: string;
};

export async function resolve_version(action_inputs: ActionInputs, repository_url: string): Promise<string> {
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

export async function get_latest_release_tag(owner: string, repo: string, github_token: string): Promise<string> {
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
