# GFS Data Explorer and GRIB2 Inspector

This project contains two primary, client-side web applications:
1.  A **GFS Data Explorer** for querying, filtering, and downloading data from the NOAA GFS collection on AWS S3.
2.  A **GRIB2 Inspector** for loading local GRIB2 files and visualizing their contents.

The core of the GRIB2 Inspector is a WebAssembly module compiled from the NCEPLIBS-g2c C library, which allows for all GRIB2 data decoding to occur directly in the web browser.

## Features

### GFS Data Explorer (`work/app/`)
* Query GFS data by date, cycle run time, and product category (resolution).
* Filter GRIB files by specific forecast hours or hour ranges.
* Inspect the inventory of individual GRIB2 files to see their contents before downloading.
* Download full GRIB files or create and download partial subsets containing only selected messages.
* Generate Python code snippets for programmatic S3 queries and downloads.

### GRIB2 Inspector (`work/jsgrib/`)
* Load local `.grib2`, `.grb2`, or `.bin` files via drag-and-drop.
* List all messages contained within a GRIB2 file.
* Display metadata for each message, including parameter name, units, and grid dimensions.
* Generate and display a heatmap visualization of the data for any message in a pop-up window, complete with a color scale and legend.

## Project Components

* **`g2c-wasm`**: A C project that wraps the NCEPLIBS-g2c library and its dependencies (`libaec`, `openjpeg`) and compiles them to a WebAssembly module (`g2clib.wasm`, `g2clib.js`) using Emscripten.
* **Windows Scripts (`*.bat`)**: A collection of batch scripts are provided to manage a Windows development environment, including setting up a portable Git installation (`install-git.bat`) and a local Node.js instance for the web server (`start-server.bat`).
* **Build Environment**: A `Dockerfile` is provided to create a consistent Ubuntu-based build environment containing all necessary tools (CMake, Ninja, Emscripten SDK) to compile the WebAssembly module.

## Setup and Usage

### Building the WebAssembly Module
The WebAssembly module is built inside a Docker container to ensure a consistent environment.

1.  **Build the Docker Image**:
    ```shell
    build-image.bat
    ```
2.  **Start an Interactive Session**:
    ```shell
    run-interactive.bat
    ```
3.  **Run the Build Script (inside Docker)**: Inside the `bash` prompt of the container, navigate to the library directory and run the build script.
    ```bash
    cd /app/g2clib-wasm
    ./build.sh
    ```
    This compiles all C sources and places the final `g2clib.js` and `g2clib.wasm` artifacts into the `work/jsgrib/` directory.

### Running the Web Applications
The applications are served by a local Node.js web server.

1.  **Start the Server**:
    ```shell
    start-server.bat
    ```
    The first time this script is run, it will download a local copy of Node.js and install the `http-server` dependency. It then starts the server.

2.  **Access the Applications**:
    * **GFS Data Explorer**: `http://localhost:8080/app/`
    * **GRIB2 Inspector**: `http://localhost:8080/jsgrib/`

## Data Citation
Data used with the GFS Data Explorer is sourced from the NOAA Global Forecast System (GFS), accessed from the AWS Open Data Registry.
