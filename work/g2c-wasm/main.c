#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "grib2.h"

/**
 * @brief A struct to hold the results of processing a GRIB field.
 * This struct's pointer will be passed to JavaScript, which will read
 * the pointers and lengths from WASM memory.
 */
typedef struct {
    char* metadata_json;    // Pointer to a JSON string with metadata
    int   metadata_len;     // The length of the JSON string
    void* data_ptr;         // Pointer to the raw data buffer
    int   data_size;        // Size of the raw data buffer in bytes
    int   num_points;       // Number of data points in the grid
} GribFieldData;


/**
 * @brief Processes a single GRIB field and returns a pointer to a struct
 * containing pointers to the extracted metadata and data.
 *
 * @param grib_data Pointer to the GRIB data buffer in WASM memory.
 * @param size The size of the GRIB data buffer.
 * @param field_num The 1-based index of the GRIB message/field to extract.
 * @return A pointer to a GribFieldData struct, or NULL on failure.
 * The caller (in JavaScript) is responsible for reading the struct's
 * contents and eventually calling free_result_memory().
 */
EMSCRIPTEN_KEEPALIVE
GribFieldData* process_grib_field(char* grib_data, int size, int field_num) {
    printf("C: process_grib_field called. size: %d, field_num: %d\n", size, field_num);
    gribfield *gfld;
    printf("C: Calling g2_getfld...\n");
    // The g2_getfld function expects an unsigned char pointer.
    // We set unpack=1 to decode the data and expand=1 to handle the grid.
    int result = g2_getfld((unsigned char *)grib_data, field_num, 1, 1, &gfld);
    printf("C: g2_getfld returned with status: %d\n", result);
    if (result != 0) {
        printf("C: g2_getfld failed. Freeing gfld and returning NULL.\n");
        // g2_getfld may or may not allocate gfld on failure, but
        // g2_free is safe to call on NULL.
        g2_free(gfld);
        return NULL;
    }
    printf("C: g2_getfld successful. gfld pointer: %p\n", gfld);
    // Build a JSON string from the gribfield metadata.
    printf("C: Building JSON from metadata...\n");
    char* json_buffer = (char*)malloc(2048);
    if (!json_buffer) {
        printf("C: ERROR - Failed to allocate memory for json_buffer.\n");
        g2_free(gfld);
        return NULL;
    }
    
    // Use %lld for g2int (long long) types to prevent compiler warnings.
    // Correctly extracting fields based on grib2.h.in and template definitions
    sprintf(json_buffer,
        "{\"discipline\":%lld, \"pdt_template\":%lld, \"parameterCategory\":%lld, "
        "\"parameterNumber\":%lld, \"grid_template\":%lld, \"grid_num_points\":%lld, "
        "\"grid_nx\":%lld, \"grid_ny\":%lld, \"packing_type\":%lld}",
        gfld->discipline, gfld->ipdtnum, gfld->ipdtmpl[0],
        gfld->ipdtmpl[1], gfld->igdtnum, gfld->ndpts, 
        (gfld->igdtnum == 0) ? gfld->igdtmpl[7] : -1, // Nx for Lat/Lon grid
        (gfld->igdtnum == 0) ? gfld->igdtmpl[8] : -1, // Ny for Lat/Lon grid
        gfld->idrtnum
    );
    printf("C: JSON buffer created: %s\n", json_buffer);


    // Allocate and populate our result struct to pass back to JS.
    GribFieldData* output = (GribFieldData*)malloc(sizeof(GribFieldData));
    if (!output) {
        printf("C: ERROR - Failed to allocate memory for output struct.\n");
        free(json_buffer);
        g2_free(gfld);
        return NULL;
    }
    printf("C: Allocated GribFieldData result struct at: %p\n", output);

    output->metadata_json = json_buffer;
    output->metadata_len = strlen(json_buffer);
    output->data_ptr = gfld->fld; // Pointer to the actual grid data
    output->data_size = gfld->ndpts * sizeof(g2float); // Size in bytes
    output->num_points = gfld->ndpts;
    printf("C: Populated result struct. metadata_ptr: %p, data_ptr: %p, data_size: %d\n",
           output->metadata_json, output->data_ptr, output->data_size);
    // We can free the top-level gribfield struct now, but NOT gfld->fld,
    // as its pointer is now held by our output struct.
    free(gfld);
    printf("C: Freed top-level gfld struct. Returning result pointer.\n");

    return output;
}

/**
 * @brief Frees the memory allocated by process_grib_field.
 * JavaScript must call this function with the pointer it received to avoid
 * memory leaks in the WASM heap.
 *
 * @param result_ptr Pointer to the GribFieldData struct to be freed.
 */
EMSCRIPTEN_KEEPALIVE
void free_result_memory(GribFieldData* result_ptr) {
    printf("C: free_result_memory called for pointer: %p\n", result_ptr);
    if (result_ptr) {
        if (result_ptr->metadata_json) {
            printf("C: -- Freeing metadata_json string.\n");
            free(result_ptr->metadata_json);
        }
        if (result_ptr->data_ptr) {
            printf("C: -- Freeing data_ptr buffer.\n");
            free(result_ptr->data_ptr);
        }
        printf("C: -- Freeing GribFieldData struct itself.\n");
        free(result_ptr);
    }
     printf("C: free_result_memory finished.\n");
}

/**
 * @brief Dummy main function required by add_executable.
 * This is not expected to be called in a JS-driven environment.
 */
int main() {
    return 0;
}