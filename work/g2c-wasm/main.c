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

// --- JSON Generation Helper Functions ---

/**
 * @brief Safely appends a source string to a destination buffer.
 * Checks for available space before concatenating to prevent buffer overflows.
 * @param dest The destination buffer.
 * @param src The source string to append.
 * @param dest_size The total allocated size of the destination buffer.
 * @return A pointer to the destination buffer.
 */
static char* append_to_buffer(char* dest, const char* src, size_t dest_size) {
    if (strlen(dest) + strlen(src) < dest_size - 1) {
        strcat(dest, src);
    }
    return dest;
}

/**
 * @brief Appends a C array of long longs to a string buffer as a JSON array.
 * @param buffer The character buffer to append the JSON array to.
 * @param buffer_size The total size of the character buffer.
 * @param arr The array of long long integers to serialize.
 * @param arr_len The number of elements in the array.
 */
static void append_json_array(char* buffer, size_t buffer_size, const g2int* arr, int arr_len) {
    append_to_buffer(buffer, "[", buffer_size);
    char temp[32];
    for (int i = 0; i < arr_len; i++) {
        sprintf(temp, "%lld", arr[i]);
        append_to_buffer(buffer, temp, buffer_size);
        if (i < arr_len - 1) {
            append_to_buffer(buffer, ",", buffer_size);
        }
    }
    append_to_buffer(buffer, "]", buffer_size);
}


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
    if (result != 0) {
        printf("C: g2_getfld failed with error code: %d\n", result);
        g2_free(gfld);
        return NULL;
    }
    printf("C: g2_getfld successful. gfld pointer: %p\n", gfld);
    
    // Allocate a buffer for the JSON string.
    printf("C: Building comprehensive JSON from metadata...\n");
    size_t json_buffer_size = 4096;
    char* json_buffer = (char*)malloc(json_buffer_size);
    if (!json_buffer) {
        printf("C: ERROR - Failed to allocate memory for json_buffer.\n");
        g2_free(gfld);
        return NULL;
    }
    json_buffer[0] = '\0'; // Initialize as an empty string.

    char temp_str[512]; // Increased size for grid object

    // --- Build the JSON string ---
    append_to_buffer(json_buffer, "{", json_buffer_size);
    
    // Top-level info
    sprintf(temp_str, "\"info\":{\"discipline\":%lld,\"packing_type\":%lld},", gfld->discipline, gfld->idrtnum);
    append_to_buffer(json_buffer, temp_str, json_buffer_size);
    
    // Sections container
    append_to_buffer(json_buffer, "\"sections\":{", json_buffer_size);
    sprintf(temp_str, "\"identification\":{\"len\":%d,\"data\":", gfld->idsectlen);
    append_to_buffer(json_buffer, temp_str, json_buffer_size);
    append_json_array(json_buffer, json_buffer_size, gfld->idsect, gfld->idsectlen);
    append_to_buffer(json_buffer, "},", json_buffer_size);
    
    sprintf(temp_str, "\"product_definition\":{\"template_num\":%lld,\"len\":%d,\"data\":", gfld->ipdtnum, gfld->ipdtlen);
    append_to_buffer(json_buffer, temp_str, json_buffer_size);
    append_json_array(json_buffer, json_buffer_size, gfld->ipdtmpl, gfld->ipdtlen);
    append_to_buffer(json_buffer, "},", json_buffer_size);

    sprintf(temp_str, "\"data_representation\":{\"template_num\":%lld,\"len\":%d,\"data\":", gfld->idrtnum, gfld->idrtlen);
    append_to_buffer(json_buffer, temp_str, json_buffer_size);
    append_json_array(json_buffer, json_buffer_size, gfld->idrtmpl, gfld->idrtlen);
    append_to_buffer(json_buffer, "},", json_buffer_size);

    // Grid Definition is last in this object
    sprintf(temp_str, "\"grid_definition\":{\"template_num\":%lld,\"len\":%d,\"data\":", gfld->igdtnum, gfld->igdtlen);
    append_to_buffer(json_buffer, temp_str, json_buffer_size);
    append_json_array(json_buffer, json_buffer_size, gfld->igdtmpl, gfld->igdtlen);
    append_to_buffer(json_buffer, "}},", json_buffer_size); // Close grid_definition and sections objects

    // Grid Object with calculated coordinates
    g2int nx = -1, ny = -1;
    float lat_first = -999.0, lon_first = -999.0, lat_last = -999.0, lon_last = -999.0;
    
    // For GDT 3.0 (Lat/Lon grid), extract coordinates using correct indices.
    if (gfld->igdtnum == 0 && gfld->igdtlen >= 16) {
        nx = gfld->igdtmpl[7];
        ny = gfld->igdtmpl[8];
        lat_first = (float)gfld->igdtmpl[11] / 1000000.0f; // La1
        lon_first = (float)gfld->igdtmpl[12] / 1000000.0f; // Lo1
        lat_last  = (float)gfld->igdtmpl[14] / 1000000.0f; // La2
        lon_last  = (float)gfld->igdtmpl[15] / 1000000.0f; // Lo2
    }

    sprintf(temp_str, "\"grid\":{\"num_points\":%lld,\"nx\":%lld,\"ny\":%lld,\"lat_first\":%f,\"lon_first\":%f,\"lat_last\":%f,\"lon_last\":%f}",
        gfld->ndpts, nx, ny, lat_first, lon_first, lat_last, lon_last);
    append_to_buffer(json_buffer, temp_str, json_buffer_size);
    
    append_to_buffer(json_buffer, "}", json_buffer_size); // Close main JSON object
    
    printf("C: JSON buffer created. Final length: %zu\n", strlen(json_buffer));

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
    output->data_ptr = gfld->fld;
    output->data_size = gfld->ndpts * sizeof(g2float);
    output->num_points = gfld->ndpts;
    printf("C: Populated result struct. metadata_ptr: %p, data_ptr: %p, data_size: %d\n",
           output->metadata_json, output->data_ptr, output->data_size);
    
    // Free the g2clib-allocated structure, but not the data pointers we are passing back.
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
 */
int main() {
    return 0;
}
