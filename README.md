# DeepSeek Harness — Runtime Docker Image

Docker packaging for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) using **pre-published npm packages**. No source compilation inside the container.

## Quick Start

Using `docker-compose` is the recommended way to deploy:

```bash
git clone https://github.com/AngelGarzaDev/deepseek-harness-docker.git
cd deepseek-harness-docker
docker-compose up -d
```

Open `http://localhost:3001` in your browser.

## How It Works

### Architecture

Single-stage, runtime-only image based on `node:24` (Debian bookworm).

#### Components

- **Pre-published npm packages**: The core package `@deepseek-ai/dsh` is installed globally via `npm install -g`.

### Security Model

DSH binds to `0.0.0.0` within the container to allow external access via Docker's `-p` port mapping. Traffic is routed directly to the DSH service.

## Configuration

### Port

By default, the container exposes port `3000` internally, which is mapped to `3001` in the provided `docker-compose.yml`. You can change these via environment variables:

```bash
# Example: Map external 8080 to internal 3000
docker run -e DSH_HTTP_PORT=3000 -p 8080:3000 deepseek-harness
```

### API Key

Pass your model provider API key at runtime:

```bash
docker run -e DEEPSEEK_API_KEY=sk-... deepseek-harness
```

For other providers, set the corresponding environment variable or configure credentials through the Web UI settings.

## Persistence

Mount a volume to persist sessions and profile customizations:

```bash
docker run -v dsh-data:/root/.dsh deepseek-harness
```

## Trusted Hosts

When accessing DSH through a reverse proxy (Cloudflare Tunnel, nginx, Caddy, etc.) the browser page origin is the proxy domain (e.g. `https://dsh.petr.ie`), not a loopback address. DSH's server-side `/api` trust fence and the client-side settings mirror both need to recognize that domain:

### Environment variable — `DSH_TRUSTED_HOSTS`

Comma-separated list of hostnames the DSH server should trust for the `/api` fence and the settings mirror:

```bash
docker run \
  -e DSH_TRUSTED_HOSTS=dsh.petr.ie \
  -p 3000:3000 \
  deepseek-harness
```

Multiple hosts:

```bash
docker run \
  -e DSH_TRUSTED_HOSTS="dsh.petr.ie,dsh.example.com:3080" \
  -p 3000:3000 \
  deepseek-harness
```

Each entry may include an explicit port (`host:port`) — port-less entries match any port.

### docker-compose

```yaml
services:
  dsh-main:
    image: deepseek-harness
    environment:
      - DSH_TRUSTED_HOSTS=dsh.petr.ie
    ports:
      - "3000:3000"
```

### What this fixes

The DSH web UI has two trust checks:

1. **Server-side `/api` fence** — accepts requests whose `Host` header matches a `--trusted-host` entry. Without this, Cloudflare Tunnel requests get **403 Forbidden**.
2. **Client-side settings persistence** — the `ui-settings` plugin uses `isLoopback` to decide whether to persist settings to disk or only in-memory. On non-loopback origins the settings mirror returns `"unavailable"`, making **Settings → Models** crash with *"Loading the provider directory failed: settings are unavailable in this browser"*.

The sidecar proxy patches the client bundle in-flight to force `isLoopback` to `true` for all proxied access, restoring full settings functionality behind any reverse proxy. It also injects a `crypto.randomUUID()` polyfill so RPC calls work outside secure contexts.

## Building

```bash
git clone https://github.com/AngelGarzaDev/deepseek-harness-docker.git
cd deepseek-harness-docker
docker build -t deepseek-harness .
```

The `.dockerignore` manages artifacts while ensuring the necessary scripts are included in the final image.

### Platform support

The published npm packages ship `linux-x64` prebuilt native addons (`koffi`, `node-pty`). Build on x86_64 Linux for best compatibility:

```bash
docker build --platform linux/amd64 -t deepseek-harness .
```

On ARM hosts, the `node:24` base (bookworm) maximizes the chance of prebuilt binary compatibility, but native addons may fall back to runtime compilation requiring `gcc` and `make`.

### Image size

Expected final image: ~1 GB (Node.js runtime + global npm packages).

## Health Check

Built-in healthcheck probes `http://localhost:<port>` every 30 seconds with a 10-second start period:

```bash
docker inspect --format='{{json .State.Health}}' <container_name>
```

## Troubleshooting

### Connection refused after starting

Wait a few seconds — the Node.js service needs time to initialize after startup. The healthcheck accounts for this with a 10-second start period.

### Permission denied errors

Ensure the container runs as the correct user. Do not override `USER root` unless you also create a compatible `.dsh` directory.

### Native addon load failures

If `koffi` or `node-pty` fail to load their prebuilt binaries, ensure the container platform matches what the npm package expects (`linux-x64`). Check logs:

```bash
docker logs <container>
```
