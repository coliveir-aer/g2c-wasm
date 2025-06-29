/**
 * main.js for the WASM Test Harness - V4 Final
 */

// --- DOM Elements ---
const summaryEl = document.getElementById('summary');
const resultsBodyEl = document.getElementById('results-body');
const outputEl = document.getElementById('output');
const testFileInfoEl = document.getElementById('test-file-info');

// --- Test Suite Definition ---
// This array defines all the regression tests to be run.
// Each group contains a title and an array of individual tests.
const TEST_SUITE = [
    {
        group: 'High-Level Structure & Parsing',
        tests: [
            {
                id: 'JSON-PARSE',
                description: 'Metadata is a valid JSON string that can be parsed',
                testFn: (parsedJson) => !!parsedJson
            },
            {
                id: 'TOP-LEVEL-STRUCTURE',
                description: 'Raw JSON has required top-level keys: "info", "sections", "grid"',
                testFn: (parsedJson) => parsedJson && typeof parsedJson.info === 'object' && typeof parsedJson.sections === 'object' && typeof parsedJson.grid === 'object'
            }
        ]
    },
    {
        group: 'Grid Definition Tests (GDT)',
        tests: [
            {
                id: 'GDT-TEMPLATE-NUM',
                description: 'Grid Definition Template Number is 0 (Lat/Lon)',
                testFn: (parsedJson) => parsedJson.sections.grid_definition.template_num === 0
            },
            {
                id: 'GRID-DIMENSIONS-NX',
                description: 'Grid data: Nx dimension is correct (360)',
                testFn: (parsedJson) => parsedJson.grid.nx === 360
            },
            {
                id: 'GRID-DIMENSIONS-NY',
                description: 'Grid data: Ny dimension is correct (181)',
                testFn: (parsedJson) => parsedJson.grid.ny === 181
            },
            {
                id: 'GRID-NUM-POINTS',
                description: 'Grid data: num_points is correct (65160)',
                testFn: (parsedJson) => parsedJson.grid.num_points === 65160
            }
        ]
    },
    {
        group: 'Coordinate & Value Tests (Corrected)',
        tests: [
             {
                id: 'COORD-LAT-FIRST',
                description: 'Calculated Coordinate: Latitude of first point is 90.0',
                testFn: (parsedJson) => parsedJson.grid.lat_first === 90.0
            },
            {
                id: 'COORD-LON-FIRST',
                description: 'Calculated Coordinate: Longitude of first point is 0.0',
                testFn: (parsedJson) => parsedJson.grid.lon_first === 0.0
            },
            {
                id: 'COORD-LAT-LAST',
                description: 'Calculated Coordinate: Latitude of last point is -90.0',
                testFn: (parsedJson) => parsedJson.grid.lat_last === -90.0
            },
            {
                id: 'COORD-LON-LAST',
                description: 'Calculated Coordinate: Longitude of last point is 359.0',
                testFn: (parsedJson) => parsedJson.grid.lon_last === 359.0
            }
        ]
    },
    {
        group: 'Identification Section (IDS) Content Tests',
        tests: [
            {
                id: 'IDS-CENTER-ID',
                description: 'Originating Center ID is 7 (US NWS)',
                testFn: (parsedJson) => parsedJson.sections.identification.data[0] === 7
            },
            {
                id: 'IDS-MASTER-TABLES',
                description: 'GRIB Master Tables Version is 2',
                testFn: (parsedJson) => parsedJson.sections.identification.data[2] === 2
            },
            {
                id: 'IDS-REF-TIME-SIG',
                description: 'Significance of Reference Time is 1 (Start of forecast)',
                testFn: (parsedJson) => parsedJson.sections.identification.data[4] === 1
            },
            {
                id: 'IDS-DATE-YEAR',
                description: 'Reference Date: Year is 2024',
                testFn: (parsedJson) => parsedJson.sections.identification.data[5] === 2024
            }
        ]
    },
    {
        group: 'Product Definition Section (PDS) Content Tests',
        tests: [
            {
                id: 'PDS-TEMPLATE-NUM',
                description: 'Product Definition Template Number is 0 (Analysis/Forecast at Horizontal Level)',
                testFn: (parsedJson) => parsedJson.sections.product_definition.template_num === 0
            },
            {
                id: 'PDS-PARAM-CATEGORY',
                description: 'Product Parameter Category is 3 (Mass)',
                testFn: (parsedJson) => parsedJson.sections.product_definition.data[0] === 3
            },
            {
                id: 'PDS-PARAM-NUMBER',
                description: 'Product Parameter Number is 1 (Pressure)',
                testFn: (parsedJson) => parsedJson.sections.product_definition.data[1] === 1
            }
        ]
    }
];

/**
 * Runs all defined tests and updates the UI.
 * @param {string} rawJsonString - The JSON string from the WASM module.
 */
function runRegressionTests(rawJsonString) {
    console.log("--- Running Regression Tests ---");
    resultsBodyEl.innerHTML = '';
    let testsPassed = 0;
    let totalTests = 0;
    let parsedJson = null;

    try {
        parsedJson = JSON.parse(rawJsonString);
    } catch (e) {
        console.error("Failed to parse data before running tests:", e);
        // This will cause tests that need the data to fail, which is correct.
    }

    TEST_SUITE.forEach(group => {
        // Add a group header row to the table
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.innerHTML = `<th colspan="3" style="background-color: #e9ecef; text-align: center; font-style: italic;">${group.group}</th>`;
        resultsBodyEl.appendChild(groupHeaderRow);

        group.tests.forEach(test => {
            totalTests++;
            const row = document.createElement('tr');
            const statusCell = document.createElement('td');
            let passed = false;

            try {
                // Pass the parsed JSON to the test function.
                // A test will fail gracefully if parsedJson is null.
                passed = test.testFn(parsedJson);
            } catch (e) {
                console.error(`Test ${test.id} threw an error:`, e);
                passed = false;
            }
            
            if (passed) {
                statusCell.textContent = 'PASS';
                statusCell.className = 'status-pass';
                testsPassed++;
            } else {
                statusCell.textContent = 'FAIL';
                statusCell.className = 'status-fail';
            }
            
            // CORRECTED: Build the row content and then append the status cell.
            row.innerHTML = `<td>${test.id}</td><td>${test.description}</td>`;
            row.appendChild(statusCell);
            resultsBodyEl.appendChild(row);
        });
    });
    
    // Update the final summary
    summaryEl.textContent = `Test Complete: ${testsPassed} / ${totalTests} Passed`;
    summaryEl.className = (testsPassed === totalTests) ? 'pass' : 'fail';
}

/**
 * The main test function. Fetches, processes, and validates a GRIB2 file.
 */
async function runTestHarness() {
    const GRIB_FILE_URL = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20240627/12/atmos/gfs.t12z.pgrb2.1p00.f000';
    const GRIB_FIELD_TO_PROCESS = 1;

    // Display the test file URL on the page
    if (testFileInfoEl) {
        testFileInfoEl.innerHTML = `<strong>Test File:</strong> <a href="${GRIB_FILE_URL}" target="_blank">${GRIB_FILE_URL}</a>`;
    }

    try {
        const response = await fetch(GRIB_FILE_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const fileBuffer = await response.arrayBuffer();

        const dataPtr = Module._malloc(fileBuffer.byteLength);
        if (dataPtr === 0) throw new Error("WASM _malloc failed to allocate memory.");
        
        Module.HEAPU8.set(new Uint8Array(fileBuffer), dataPtr);

        const resultPtr = Module.ccall('process_grib_field', 'number', ['number', 'number', 'number'], [dataPtr, fileBuffer.byteLength, GRIB_FIELD_TO_PROCESS]);

        if (resultPtr === 0) {
            throw new Error("C function returned a NULL pointer, indicating a processing error.");
        }

        const metadataJsonPtr = Module.getValue(resultPtr, '*');
        const metadataJsonLen = Module.getValue(resultPtr + 4, 'i32');
        const metadataJson = Module.UTF8ToString(metadataJsonPtr, metadataJsonLen);
        
        // Display the raw JSON for informational purposes
        outputEl.textContent = JSON.stringify(JSON.parse(metadataJson), null, 2);
        
        // Run the corrected regression tests
        runRegressionTests(metadataJson);

        // Clean up memory
        Module.ccall('free_result_memory', null, ['number'], [resultPtr]);
        Module._free(dataPtr);

    } catch (error) {
        console.error('Test harness failed:', error);
        summaryEl.textContent = `Critical Error: ${error.message}`;
        summaryEl.className = 'fail';
        outputEl.textContent = `Error: ${error.message}`;
    }
}

// --- Entry Point ---
window.addEventListener('wasmReady', () => {
    console.log('WASM runtime ready. Starting test harness...');
    runTestHarness();
});
