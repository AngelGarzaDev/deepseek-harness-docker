# DeepSeek Harness — Runtime Docker Image

Docker packaging for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) using **pre-published npm packages**. No source compilation inside the container.

## Quick Start

```bash
# Build locally:
git clone https://github.com/AngelGarzaDev/deepseek-harness-docker.git
cd deepseek-harness-docker
docker build -t deepseek-harness .

# Run with Web GUI (port 3000)
docker run -p 3000:3000 deepseek-harness
```

Open `http://localhost:3000` in your browser.

## How It Works

### Architecture

Single-stage, runtime-only image based on `node:22-slim` (Debian bookworm).

#### Pre-published npm packages

Two packages are installed globally via `npm install -g`:

| Package | Version | Purpose |
|---------|---------|---------|
| `@deepseek-ai/dsh` | v0.1.5-rc.2 | CLI launcher & profiles (pre-bundled `lib/`) |
| `@deepseek-ai/dsh-web-frontend` | v0.0.1-rc.5 | Web GUI static assets (`dist/` with HTML, CSS, JS, fonts) |

No source code is copied into the image. No build step runs inside the container.

#### Non-root user

Runs as `dshuser` (UID/GID 1001) with home at `/home/dshuser` and a pre-created `.dsh` subdirectory for session persistence.

#### Reverse proxy (socat)

DSH intentionally rejects `--host 0.0.0.0` for safety reasons — it only binds to `127.0.0.1`. Since Docker's `-p` port mapping requires the server to listen on `0.0.0.0`, the image uses `socat` as a reverse proxy:

```
External request → 0.0.0.0:3000 (socat) → 127.0.0.1:3000 (dsh web)
```

This gives you external access while keeping DSH's security model intact.

## Configuration

### Port

The default HTTP port is `3000`. Change it via the `DSH_HTTP_PORT` environment variable:

```bash
docker run -e DSH_HTTP_PORT=8080 -p 8080:8080 deepseek-harness
```

### API Key

Pass your model provider API key at runtime:

```bash
docker run -e DEEPSEEK_API_KEY=sk-... deepseek-harness
```

For other providers, set the corresponding environment variable or configure credentials through the Web UI settings.

### Persistence

Mount a volume to persist sessions and profile customizations:

```bash
docker run -v dsh-data:/home/dshuser/.dsh deepseek-harness
```

### Trusted Hosts

If accessing from a non-standard hostname, declare it as trusted:

```bash
docker run deepseek-harness web --trusted-host myhost.local
```

## Building

```bash
git clone https://github.com/AngelGarzaDev/deepseek-harness-docker.git
cd deepseek-harness-docker
docker build -t deepseek-harness .
```

The `.dockerignore` excludes everything except `Dockerfile` and `entrypoint.sh` — no application source is copied into the image.

### Platform support

The published npm packages ship `linux-x64` prebuilt native addons (`koffi`, `node-pty`). Build on x86_64 Linux for best compatibility:

```bash
docker build --platform linux/amd64 -t deepseek-harness .
```

On ARM hosts, the `node:22-slim` base (bookworm) maximizes the chance of prebuilt binary compatibility, but native addons may fall back to runtime compilation requiring `gcc` and `make`.

### Image size

Expected final image: ~1 GB (Node.js runtime + global npm packages + socat).

## Health Check

Built-in healthcheck probes `http://localhost:<port>` every 30 seconds with a 10-second start period:

```bash
docker inspect --format='{{json .State.Health}}' <container_name>
```

## Troubleshooting

### Connection refused after starting

Wait a few seconds — the socat proxy needs ~2 seconds to initialize after DSH starts. The healthcheck accounts for this with a 10-second start period.

### Permission denied errors

Ensure the container runs as the correct user. Do not override `USER dshuser` unless you also create a compatible `.dsh` directory.

### Native addon load failures

If `koffi` or `node-pty` fail to load their prebuilt binaries, ensure the container platform matches what the npm package expects (`linux-x64`). Check logs:

```bash
docker logs <container>
```
