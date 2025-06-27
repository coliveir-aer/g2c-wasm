# Use a standard Ubuntu Linux base image.
FROM ubuntu:22.04

# Avoid interactive prompts during package installation.
ENV DEBIAN_FRONTEND=noninteractive

# Install all necessary system dependencies, including ca-certificates, xz-utils, and libatomic1.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    cmake \
    ninja-build \
    python3 \
    ca-certificates \
    xz-utils \
    libatomic1 \
    pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Clone and set up the Emscripten SDK inside the container.
RUN git clone https://github.com/emscripten-core/emsdk.git /emsdk
WORKDIR /emsdk
RUN ./emsdk install latest && \
    ./emsdk activate latest

# Set the working directory for our project.
WORKDIR /app

# This entrypoint script will activate the Emscripten environment
# every time the container starts, ensuring emcmake/emmake are always available.
ENTRYPOINT [ "/bin/bash", "-c", "source /emsdk/emsdk_env.sh && exec \"$@\"", "--" ]