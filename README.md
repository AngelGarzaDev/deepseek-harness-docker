# DeepSeek Harness Docker

Docker packaging for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — an AI agent framework with Web GUI, headless profiles, and native sandboxing.

## Prerequisites

Clone the upstream project, then apply this Dockerfile on top:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cp /path/to/dockerfile-repo/* deepseek-harness/   # Dockerfile, .dockerignore
```

Or fork and merge these files into your own copy of the repo.

## Quick Start

```bash
# From the deepseek-harness directory
docker build -t deepseek-harness .
```

# Run with Web GUI (port 3000)
docker run -p 3000:3000 deepseek-harness

# Run headless (agent-only, no webserver)
docker run deepseek-harness --profile headless "your task here"
```

## Image Architecture

The Dockerfile uses a multi-stage build optimized for size and reproducibility:

### Stage 1 — Builder (`node:22-bookworm`)

Installs compilation toolchain and builds everything:

| Package | Purpose |
|---------|---------|
| `build-essential` | gcc for Node-API native addon (flock) |
| `musl-tools` | musl-gcc for static landlock-run binary |
| `git` | `repositoryCommitHash()` needs `git rev-parse HEAD` |
| `python3` | Required by esbuild dependency |

Build pipeline runs through `tsx scripts/build.ts`, executing three phases sequentially:

1. **`build:native-system`** — C compilation of native addons (landlock-run under musl, flock addon under glibc)
2. **`build:lib`** — TypeScript compilation + tsdown bundling for all workspace packages
3. **`build:web`** — Vite React frontend build

A build record (`.dsh-build/client-build-environment.json`) captures environment variables bound to every built artifact by content digest.

### Stage 2 — Production (`node:22-slim`)

Runtime-only image. Copies the complete workspace tree from the builder stage to preserve pnpm workspace symlinks, which use absolute paths (`/app/...`). The same WORKDIR across stages keeps those symlinks valid.

Security measures:
- Non-root user (`dshuser`, UID/GID 1001)
- Health check probing the web server

## Configuration

### Port

The default HTTP port is `3000`. Override via:

```bash
# Environment variable
docker run -e DSH_HTTP_PORT=8080 -p 8080:8080 deepseek-harness

# CLI flag
docker run deepseek-harness web --config http.port=8080
```

### API Key

Pass your model provider API key at runtime:

```bash
docker run -e DEEPSEEK_API_KEY=sk-... deepseek-harness
```

For other providers, set the corresponding environment variable or pass credentials through the `--config` flag.

### Persistence

Mount a volume to persist session data:

```bash
docker run -v dsh-data:/app/.dsh deepseek-harness
```

### Profiles

| Profile | Description |
|---------|-------------|
| `web` (default) | Serve the Web GUI on port 3000 |
| `headless` | Agent-only mode without webserver |

## Build Options

### Platform-specific build

```bash
docker build --platform linux/amd64 -t deepseek-harness .
```

### Cache mount (Docker BuildKit)

The Dockerfile uses `--mount=type=cache` for the pnpm store. Enable BuildKit:

```bash
export DOCKER_BUILDKIT=1
docker build -t deepseek-harness .
```

### Image size

The production stage is `node:22-slim` (~180 MB base). Total image size depends on compiled artifacts; expect ~600-800 MB final image due to the full monorepo workspace copy required for symlink integrity.

## Troubleshooting

### Symlink errors at runtime

pnpm creates absolute-path symlinks inside `/app`. If you change `WORKDIR` between stages or mount volumes over `/app`, those symlinks break. Keep the workspace at `/app` in both stages.

### Native addon failures

Ensure `musl-tools` and `gcc` are available during the build stage. On Apple Silicon hosts, use `--platform linux/amd64` unless the native addon supports ARM.

### Build fails with git error

The build script calls `git rev-parse HEAD`. Git must be installed in the builder stage (included by default). If you clone the repo without git history (e.g., `--depth 1`), this may fail depending on the script implementation.
