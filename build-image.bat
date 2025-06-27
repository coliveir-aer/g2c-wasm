REM This script disables BuildKit and uses the classic builder.
set DOCKER_BUILDKIT=0
docker build -t g2clib-wasm-builder .