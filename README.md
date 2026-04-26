# setup-vmb

GitHub Action for setting up [vmb](https://github.com/ScriptExec/vmb) with a specific version.

### Usage

```yaml
- uses: ScriptExec/setup-vmb@v1
  with:
    version: latest
```

### Inputs

- `version`: The version of `vmb` to install [default: `latest`]
- `github-token`: Token used when resolving releases from GitHub. The token is not mandatory, but it is recommended to avoid hitting the GitHub API rate limit.

#### Example Workflow

```yaml
name: Test vmb
on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up vmb
        uses: ScriptExec/setup-vmb@v1
        with:
          version: latest
          github-token: ${{ github.token }}

      - name: Verify vmb
        run: vmb --version
```
