# Our final, top-level CMake file to build g2clib for WebAssembly.
cmake_minimum_required(VERSION 3.15)
project(g2clib-wasm C)

# The CMAKE_INSTALL_PREFIX will be set by our build script.
set(GENERATED_HEADER_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated_headers)

add_compile_definitions(_LARGEFILE64_SOURCE)

set(G2_AEC_ENABLED ON)
set(G2_JPEG2000_ENABLED ON)
set(G2_PNG_ENABLED ON)
add_compile_definitions(_LARGEFILE64_SOURCE)
set(PNG_WIDTH_MAX 100000000 CACHE STRING "Default width of PNG grid.")
set(PNG_HEIGHT_MAX 100000 CACHE STRING "Default height of PNG grid.")

# --- Add Dependencies as Sub-projects ---
add_subdirectory(source/libaec libaec)
set(BUILD_SHARED_LIBS ON CACHE BOOL "Build a 'shared' (actually static) lib" FORCE)
set(BUILD_STATIC_LIBS OFF CACHE BOOL "Do NOT build a separate static lib" FORCE)
add_subdirectory(source/openjpeg openjpeg)

# --- Generate the grib2.h header from its template ---
message(STATUS "Generating grib2.h from template...")
configure_file(
  source/g2c/src/grib2.h.in
  ${GENERATED_HEADER_DIR}/grib2.h
)

# --- Define the Static Library Target ---
# 1. Specify the EXACT source files to compile.
set(G2C_SOURCES
  source/g2c/src/cmplxpack.c
  source/g2c/src/compack.c
  source/g2c/src/comunpack.c
  source/g2c/src/drstemplates.c
  source/g2c/src/g2_addfield.c
  source/g2c/src/g2_addgrid.c
  source/g2c/src/g2_addlocal.c
  source/g2c/src/g2_create.c
  source/g2c/src/g2_free.c
  source/g2c/src/g2_getfld.c
  source/g2c/src/g2_gribend.c
  source/g2c/src/g2_info.c
  source/g2c/src/g2_miss.c
  source/g2c/src/g2_unpack1.c
  source/g2c/src/g2_unpack2.c
  source/g2c/src/g2_unpack3.c
  source/g2c/src/g2_unpack4.c
  source/g2c/src/g2_unpack5.c
  source/g2c/src/g2_unpack6.c
  source/g2c/src/g2_unpack7.c
  source/g2c/src/gbits.c
  source/g2c/src/getdim.c
  source/g2c/src/getpoly.c
  source/g2c/src/gridtemplates.c
  source/g2c/src/int_power.c
  source/g2c/src/misspack.c
  source/g2c/src/mkieee.c
  source/g2c/src/pack_gp.c
  source/g2c/src/pdstemplates.c
  source/g2c/src/rdieee.c
  source/g2c/src/reduce.c
  source/g2c/src/seekgb.c
  source/g2c/src/simpack.c
  source/g2c/src/simunpack.c
  source/g2c/src/specpack.c
  source/g2c/src/specunpack.c
  source/g2c/src/util.c
  source/g2c/src/decenc_png.c
  source/g2c/src/pngpack.c
  source/g2c/src/pngunpack.c
  source/g2c/src/decenc_openjpeg.c
  source/g2c/src/jpcpack.c
  source/g2c/src/jpcunpack.c
  source/g2c/src/decenc_aec.c
  source/g2c/src/aecpack.c
  source/g2c/src/aecunpack.c
)

# 2. Create the static library target.
add_library(g2clib_static ${G2C_SOURCES})

# 3. Add include directories to the static library.
target_include_directories(g2clib_static PUBLIC
  ${CMAKE_INSTALL_PREFIX}/include
  ${CMAKE_INSTALL_PREFIX}/include/openjpeg-2.5
  ${GENERATED_HEADER_DIR}
  source/g2c/src
  source/openjpeg/thirdparty/libpng
)

# 4. Define pre-processor flags to enable features.
target_compile_definitions(g2clib_static PUBLIC
  -DUSE_AEC=1
  -DUSE_PNG=1
  -DUSE_OPENJPEG=1
  -DJPEG=1
)

# 5. Link the static library against its dependencies.
target_link_libraries(g2clib_static PUBLIC
  "${CMAKE_INSTALL_PREFIX}/lib/libaec.a"
  "${CMAKE_INSTALL_PREFIX}/lib/libsz.a"
  "${CMAKE_INSTALL_PREFIX}/lib/libopenjp2.a"
)


# --- Define the Final WASM Module (Executable) Target ---
# 1. Add the executable target, which includes our C wrapper.
add_executable(g2clib main.c)

# 2. Link our executable against the static library we just defined.
target_link_libraries(g2clib PRIVATE g2clib_static)

# 3. Set the output name, suffix, and all linker flags for our final executable.
set_target_properties(g2clib PROPERTIES
  OUTPUT_NAME "g2clib"
  SUFFIX ".js"
  LINK_FLAGS "-s EXPORTED_FUNCTIONS=['_malloc','_free','_process_grib_field','_free_result_memory','_main'] -s EXPORTED_RUNTIME_METHODS=['ccall','HEAPU8','getValue','UTF8ToString'] -s ALLOW_MEMORY_GROWTH=1 -s USE_ZLIB=1 -s USE_LIBPNG=1 -s STACK_SIZE=20MB"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
)
