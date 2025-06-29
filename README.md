# g2c-wasm: A WebAssembly Wrapper for NOAA's NCEPLIBS-g2c Library

This project demonstrates a WebAssembly (WASM) wrapper for the [NOAA NCEPLIBS-g2c C library](https://github.com/NOAA-EMC/NCEPLIBS-g2c/tree/develop). The primary goal is to enable the decoding and processing of GRIB2 (GRIdded Binary Edition 2) weather data files entirely on the client-side, within a standard web browser.

The core of the project is a C wrapper around `NCEPLIBS-g2c` and its dependencies, compiled to WebAssembly using Emscripten. This allows web applications to perform data extraction without needing a server-side backend.

An example deployment of the GFS Live demo site is up at: [https://coliveir-aer.github.io/g2c-wasm/](https://coliveir-aer.github.io/g2c-wasm/)

---

## Project Components

* **`g2c-wasm` (WASM Module Project)**: A C project that wraps the `NCEPLIBS-g2c` library and its dependencies (`libaec`, `openjpeg`), which are included as Git submodules.
* **Build Environment**: A `Dockerfile` creates a consistent, Ubuntu-based build environment with all necessary tools (CMake, Ninja, Emscripten SDK) to compile the WebAssembly module.
* **Windows Development Scripts**: A collection of batch scripts (`.bat`) is provided to manage a portable Windows development environment, including local setup for Git and a Node.js web server.
* **Application Examples**: A collection of applications that demonstrate the capabilities of the WASM module and provide development tools.

## Setup and Usage

### Prerequisites
* **Docker**: Required for building the WebAssembly module.
* **Web Browser**: For running the example applications.

### Building the WebAssembly Module

The WASM module is built inside a Docker container to ensure a consistent environment. The final artifacts (`g2clib.js`, `g2clib.wasm`) are placed in the relevant application directories within `/work`.

1.  **Build the Docker Image**:
    This command builds the Docker image named `g2clib-wasm-builder`.
    ```shell
    # On Windows
    build-image.bat

    # On Linux/macOS
    ./build-image.sh
    ```

2.  **Start an Interactive Session**:
    This command starts a `bash` shell inside the container and mounts the local `work/` directory to `/app` in the container.
    ```shell
    # On Windows
    run-interactive.bat

    # On Linux/macOS
    ./run-interactive.sh
    ```

3.  **Run the Build Script (Inside Docker)**:
    Inside the container's `bash` prompt, run the build script. It compiles all dependencies and then the main library.
    ```bash
    cd /app/g2c-wasm
    ./build.sh
    ```

---

## Example Applications

### 1. GFS Live Weather Viewer (`/work/viewer`)

This is the primary demonstration application. It is a modern, map-centric weather viewer that fetches and renders GFS model data directly from the NOAA S3 bucket in the browser.

* **Features**:
    * Automatically finds and loads data from the latest available GFS model run.
    * Displays weather data as an overlay on a Leaflet map.
    * Features an intuitive timeline slider for selecting different forecast times.
    * Currently supports 2m Temperature and Total Precipitation products.
    * Engineered to be lightweight and performant by only fetching the required byte ranges for each GRIB message.
    * Still a very early prototype of what it could become.

### 2. GRIB2 Inspector (`/work/jsgrib`)

A client-side utility for inspecting the contents of local GRIB2 files. This application directly uses the compiled `g2clib.wasm` module to process user-provided files via drag-and-drop.

* **Features**:
    * Load local GRIB2 files.
    * Lists all messages contained within a file.
    * Displays key metadata for each message.
    * Generates a heatmap visualization of the data for any selected message.

### 3. WASM Test Harness (`/work/test-site`)

A lightweight developer tool for verifying the integrity of the WebAssembly module. It runs a suite of regression tests against a known GRIB file to ensure the C code and JSON output are correct after any modifications.

### 4. GFS Data Explorer (`/work/app`)

A utility for querying and filtering the full GFS data collection on AWS S3. This tool is useful for discovering available data and generating download scripts, but it does not use the WebAssembly module.

### Running the Example Applications

The applications are served by a local web server.

1.  **Start the Server**:
    For Windows users, a convenience script is provided which will download a local copy of Node.js and dependencies on first run.
    ```shell
    start-server.bat
    ```
    For other operating systems, you can run a simple Python web server from the `work` directory:
    ```shell
    cd ./work && python -m http.server 8080
    ```

2.  **Access the Applications**:
    * **GFS Live Weather Viewer**: `http://localhost:8080/viewer/`
    * **GRIB2 Inspector**: `http://localhost:8080/jsgrib/`
    * **WASM Test Harness**: `http://localhost:8080/test-site/`
    * **GFS Data Explorer**: `http://localhost:8080/app/`

## Boring (or interesting?) details

Dependencies:

- libz and libpng are included via EMSCRIPTEN precompiled libraries
- jasper is excluded from this initial integration
- openjpeg is included as a git submodule and compiled from unmodified source code
- libaec is included as a git submodule and compiled from unmodified source code
- g2c included as a git submodule and compiled from unmodified source code


## Data Citation
Data used with the GFS Data Explorer is sourced from the NOAA Global Forecast System (GFS), accessed from the AWS Open Data Registry.

## LICENSE
The software license for this project is the LGPLV3 in compliance with the g2clib project, since it relies fully on the g2clib other than the GFS Data Explorer example, which is under the MIT LICENSE.
