# g2c-wasm: A WebAssembly Wrapper for NOAA's NCEPLIBS-g2c Library

This project demonstrates a WebAssembly (WASM) wrapper for the [NOAA NCEPLIBS-g2c C library](https://github.com/NOAA-EMC/NCEPLIBS-g2c/tree/develop). The primary goal is to enable the decoding and processing of GRIB2 (GRIdded Binary Edition 2) weather data files entirely on the client-side, within a standard web browser.

The core of the project is a C wrapper around `NCEPLIBS-g2c` and its dependencies, compiled to WebAssembly using Emscripten. This allows web applications to perform data extraction without needing a server-side backend.

To exercise the capabilities of the WASM module, this repository includes example applications.

## Example Applications

### 1. GFS Data Explorer (`/work/app`)

A utility for querying, filtering, and downloading data from the NOAA Global Forecast System (GFS) collection on the AWS Open Data Registry.

This utility site does not use the webassembly module (yet), it just provides a means of gathering data to display.

* **Features**:
    * Query GFS data by date, cycle run time, and product resolution.
    * Filter results by specific forecast hours or hour ranges.
    * Inspect the message inventory of individual GRIB2 files before downloading.
    * Download full GRIB files or create and download partial files containing only selected messages.
    * Generate Python code snippets for programmatic S3 queries.

### 2. GRIB2 Inspector (`/work/jsgrib`)

A client-side tool for loading and visualizing local GRIB2 files. This application directly uses the compiled `g2clib.wasm` module to process user-provided files.

* **Features**:
    * Load local GRIB2 files via drag-and-drop.
    * List all messages contained within a GRIB2 file.
    * Display metadata for each message, including parameter, units, and grid dimensions.
    * Generate and display a heatmap visualization of the data for any selected message.

### 3. GFS Live (Experimental)

A client side tool for display of live GFS data in a user-friendly map view loading only the necessary ranges of bytes from the product files stored on S3.

This one is only in the very early prototype stage.

---

## Project Components

* **`g2c-wasm` (WASM Module Project)**: A C project that wraps the `NCEPLIBS-g2c` library and its dependencies (`libaec`, `openjpeg`), which are included as Git submodules.
* **Build Environment**: A `Dockerfile` creates a consistent, Ubuntu-based build environment with all necessary tools (CMake, Ninja, Emscripten SDK) to compile the WebAssembly module.
* **Windows Development Scripts**: A collection of batch scripts (`.bat`) is provided to manage a portable Windows development environment, including local setup for Git and a Node.js web server.
* **Experimental Site (`/work/newsite`)**: A work-in-progress application demonstrating a more advanced, map-based interface for GFS data.

## Setup and Usage

### Prerequisites
* **Docker**: Required for building the WebAssembly module.
* **Web Browser**: For running the example applications.

### 1. Building the WebAssembly Module

The WASM module is built inside a Docker container to ensure a consistent environment. The final artifacts (`g2clib.js`, `g2clib.wasm`) are placed in the `/work/jsgrib` directory.

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

### 2. Running the Example Applications

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
    * **GFS Data Explorer**: `http://localhost:8080/app/`
    * **GRIB2 Inspector**: `http://localhost:8080/jsgrib/`
    * **GFS Live (Experimental)**: `http://localhost:8080/newsite/`

## Data Citation
Data used with the GFS Data Explorer is sourced from the NOAA Global Forecast System (GFS), accessed from the AWS Open Data Registry.

## LICENSE
The software license for this project is the LGPLV3 in compliance with the g2clib project, since it relies fully on the g2clib other than the GFS Data Explorer example, which is under the MIT LICENSE.
