# TCP Sniffer — Container image (Stream D).
# Linux, Node, libpcap; entrypoint reads env and runs createSniffer (real C++ engine when addon is built).
# See docs/specs/DEPLOYMENT_OPS.md and docs/plans/IMPLEMENTATION_LAYOUT.md.

# ---- Builder: compile native addon and TypeScript ----
FROM node:20-bookworm AS builder

# Build deps for node-gyp and libpcap native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpcap-dev \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY binding.gyp ./
COPY native ./native
RUN npm run build:native

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Production: runtime deps only; copy built addon and dist ----
FROM node:20-bookworm-slim

# libpcap for capture (required at runtime when C++ engine is used)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpcap0.8 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build

# Non-root user (optional; NET_RAW may require capability either way)
# RUN adduser --disabled-password sniffer && chown -R sniffer /app
# USER sniffer

# Container runs the TS entrypoint; it reads PORTS, INTERFACE, OUTPUT_URL, etc.
# Kubernetes injector adds NET_RAW capability and env (see INJECTOR.md).
ENTRYPOINT ["node", "dist/entrypoint.js"]
