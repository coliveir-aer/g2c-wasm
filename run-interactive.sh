# Starts an interactive bash session inside the container's /app directory.
docker run -it --rm -v "`pwd`/work:/app" --name g2clib-wasm-build g2clib-wasm-builder bash
