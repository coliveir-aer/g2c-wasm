#!/bin/bash
set -e # Exit immediately if a command fails

echo "--- [g2c-wasm] STARTING YOUR SEQUENTIAL BUILD PLAN ---"

# --- Environment and Directories ---
BASE_DIR=/app/g2c-wasm
BUILD_DIR=${BASE_DIR}/build
INSTALL_DIR=${BASE_DIR}/install
FINAL_DIST_DIR=/app/jsgrib

# --- 1. Clean and Configure ---
echo "--- [g2c-wasm] STEP 1: Cleaning and Configuring Project... ---"
rm -rf $BUILD_DIR $INSTALL_DIR
mkdir -p $BUILD_DIR
cd $BUILD_DIR

# This single command reads our top-level CMakeLists.txt and prepares the entire build.
emcmake cmake .. -G "Ninja" -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR

# --- 2. Build and Install Dependencies FIRST ---
# We explicitly tell Ninja to run the 'install' rule for each dependency.
# This builds it and copies the headers/libs to the install directory.
echo "--- [g2c-wasm] STEP 2: Building and Installing Dependencies... ---"
emmake ninja -v libaec/install
emmake ninja -v openjpeg/install

# --- 3. Build the Final g2clib Library ---
# Now that the install/ directory is guaranteed to be populated,
# we can safely build our final library.
echo "--- [g2c-wasm] STEP 3: Building Final Library... ---"
emmake ninja -v g2clib

# --- 4. Copy Final Artifacts ---
echo "--- [g2c-wasm] STEP 4: Copying Final Artifacts... ---"
mkdir -p ${FINAL_DIST_DIR}
cp g2clib.js ${FINAL_DIST_DIR}/
cp g2clib.wasm ${FINAL_DIST_DIR}/

echo "--- [g2c-wasm] BUILD COMPLETE ---"
echo "WASM artifacts have been successfully placed in: $FINAL_DIST_DIR"
