// --- CONSTANTS AND CONFIGURATION ---

// Base URL for the NOAA GFS S3 bucket.
const S3_BUCKET_URL = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/';

// The GFS product type to be used. 'pgrb2.0p25' is 0.25 degree, 'pgrb2.1p00' is 1.00 degree.
// We use 1.00 degree for now for faster testing and loading.
const GFS_PRODUCT_TYPE = 'pgrb2.1p00'; 

// Definition of the weather products we want to make available.
// This structure can be easily expanded with more products or levels.
const AVAILABLE_PRODUCTS = {
    'temp_2m': {
        name: '2m Temperature',
        product: 'TMP',
        level: '2 m above ground',
        // Simple color scale for temperature in Kelvin.
        // This can be replaced with a more sophisticated gradient library later.
        colorScale: (value) => { 
            if (value < 250) return [0, 0, 139]; // Dark Blue
            if (value < 260) return [0, 0, 255]; // Blue
            if (value < 270) return [0, 255, 255]; // Cyan
            if (value < 280) return [0, 255, 0]; // Green
            if (value < 290) return [255, 255, 0]; // Yellow
            if (value < 300) return [255, 165, 0]; // Orange
            if (value < 310) return [255, 0, 0]; // Red
            return [139, 0, 0]; // Dark Red
        }
    },
    // Future products like wind, precipitation, etc., can be added here.
};


// --- APPLICATION STATE ---

// Holds the current state of the viewer (selected time, product, etc.)
const appState = {
    gfsRun: { date: null, cycle: -1 }, // Date object (UTC) and cycle hour (0, 6, 12, 18)
    selectedTimestamp: 0,              // The currently selected time on the slider (Unix timestamp)
    selectedProduct: 'temp_2m',        // Key from AVAILABLE_PRODUCTS
    map: null,                         // Leaflet map object
    dataOverlay: null,                 // Leaflet overlay layer for the weather data
    isFetching: false,                 // A flag to prevent concurrent data fetches
};


// --- DOM ELEMENT REFERENCES ---
const domElements = {
    map: document.getElementById('map'),
    productSelector: document.getElementById('product-selector'),
    // levelSelector: document.getElementById('level-selector'), // Placeholder for future use
    timelineSlider: document.getElementById('timeline-slider'),
    forecastHourDisplay: document.getElementById('forecast-hour-display'),
    runInfo: document.getElementById('run-info'),
};


// --- CORE APPLICATION LOGIC ---

/**
 * Initializes the entire application.
 * This function is called once the WASM module is ready.
 */
async function initializeApp() {
    console.log('Initializing application...');
    domElements.runInfo.textContent = 'Finding latest GFS model run...';

    // 1. Initialize the Leaflet map.
    // Use the EPSG4326 projection, which is a simple cylindrical projection
    // that maps latitude and longitude directly, avoiding Mercator distortion.
    appState.map = L.map(domElements.map, {
        crs: L.CRS.EPSG4326,
        worldCopyJump: true
    }).setView([40, -95], 3); 
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(appState.map);

    // 2. Find the latest available GFS run
    const latestRun = await findLatestGfsRun();
    if (!latestRun) {
        domElements.runInfo.textContent = 'Error: Could not find any recent GFS model runs.';
        return;
    }
    appState.gfsRun = latestRun;
    console.log(`Latest GFS run found: ${latestRun.date.toISOString().slice(0, 10)} ${latestRun.cycle}Z`);

    // 3. Populate UI controls
    populateProductSelector();
    setupTimeSlider();

    // 4. Add event listeners
    setupEventListeners();

    // 5. Fetch and display data for the initial time
    fetchAndDisplayData();
}

/**
 * Probes the NOAA S3 bucket to find the most recent GFS model run directory.
 * This function is robust against timezone issues and network requests by iterating
 * day by day, not hour by hour.
 * @returns {Promise<{date: Date, cycle: number}|null>} The date and cycle of the latest run.
 */
async function findLatestGfsRun() {
    // Start search from 6 hours in the future to ensure we catch the latest UTC date.
    let currentDate = new Date(Date.now() + 6 * 60 * 60 * 1000);

    // Look back up to 3 days to find a valid run.
    for (let i = 0; i < 3; i++) {
        const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        
        // Check cycles in reverse chronological order (18Z, 12Z, 6Z, 0Z) for efficiency.
        for (const cycle of [18, 12, 6, 0]) {
            const cycleStr = cycle.toString().padStart(2, '0');
            const testUrl = `${S3_BUCKET_URL}gfs.${dateStr}/${cycleStr}/atmos/gfs.t${cycleStr}z.${GFS_PRODUCT_TYPE}.f000.idx`;
            console.log(`Checking for run: ${testUrl}`);
            
            try {
                // Use a ranged GET request to check for file existence, which is CORS-friendly.
                const response = await fetch(testUrl, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
                // A 206 "Partial Content" status confirms the file exists and the server supports ranged requests.
                if (response.status === 206) {
                    // Success! We found a run. Return the UTC date and cycle.
                    const runDate = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()));
                    return { date: runDate, cycle: cycle };
                }
            } catch (e) {
                // Ignore fetch errors (e.g., network issue, CORS) and continue to the next candidate.
                console.warn(`Request for ${testUrl} failed, likely does not exist.`, e);
            }
        }
        // If no run was found for the current day, go back one day.
        currentDate.setUTCDate(currentDate.getUTCDate() - 1);
    }
    
    return null; // No run found after searching.
}

/**
 * Main function to orchestrate fetching and rendering data.
 */
async function fetchAndDisplayData() {
    if (appState.isFetching) {
        console.warn('Already fetching data, new request ignored.');
        return;
    }
    appState.isFetching = true;
    domElements.runInfo.textContent = 'Fetching data...';

    try {
        const runTimestamp = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
        const forecastHour = Math.round((appState.selectedTimestamp - runTimestamp) / (60 * 60 * 1000));
        
        const dateStr = appState.gfsRun.date.toISOString().slice(0, 10).replace(/-/g, '');
        const cycleStr = appState.gfsRun.cycle.toString().padStart(2, '0');
        const hourStr = forecastHour.toString().padStart(3, '0');
        
        const fileName = `gfs.t${cycleStr}z.${GFS_PRODUCT_TYPE}.f${hourStr}`;
        const s3Path = `gfs.${dateStr}/${cycleStr}/atmos/${fileName}`;
        const idxUrl = `${S3_BUCKET_URL}${s3Path}.idx`;

        domElements.runInfo.textContent = 'Fetching GRIB index...';
        const idxResponse = await fetch(idxUrl);
        if (!idxResponse.ok) throw new Error(`Could not fetch index for F${hourStr}: ${idxResponse.statusText}`);
        const indexText = await idxResponse.text();

        const productInfo = AVAILABLE_PRODUCTS[appState.selectedProduct];
        const byteRange = findMessageInIndex(indexText, productInfo);
        if (!byteRange) throw new Error(`Could not find ${productInfo.name} in index file for F${hourStr}.`);

        domElements.runInfo.textContent = 'Fetching GRIB message...';
        const gribResponse = await fetch(`${S3_BUCKET_URL}${s3Path}`, {
            headers: { 'Range': `bytes=${byteRange.start}-${byteRange.end}` }
        });
        if (!gribResponse.ok) throw new Error(`Byte range fetch failed for F${hourStr}: ${gribResponse.statusText}`);
        const gribMessageBuffer = await gribResponse.arrayBuffer();

        domElements.runInfo.textContent = 'Decoding with WASM...';
        const decodedData = processGribData(gribMessageBuffer);
        if (!decodedData) throw new Error('WASM module failed to decode data.');
        
        domElements.runInfo.textContent = 'Rendering map overlay...';
        await renderDataOnMap(decodedData);
        
        const runDateString = new Date(runTimestamp).toUTCString();
        domElements.runInfo.textContent = `Displaying GFS Run: ${runDateString}`;

    } catch (error) {
        console.error('Error in fetchAndDisplayData:', error);
        domElements.runInfo.textContent = `Error: ${error.message}`;
    } finally {
        appState.isFetching = false;
    }
}

/**
 * Searches the GRIB index file text for a specific product and level.
 * @param {string} indexText - The plain text content of the .idx file.
 * @param {object} productInfo - An object from AVAILABLE_PRODUCTS.
 * @returns {{start: number, end: string}|null} The byte range of the message.
 */
function findMessageInIndex(indexText, productInfo) {
    const lines = indexText.split('\n');
    const startBytes = lines.map(line => {
        const fields = line.split(':');
        return fields.length > 1 ? parseInt(fields[1], 10) : null;
    });

    const targetLineIndex = lines.findIndex(line => {
        const fields = line.split(':');
        return fields.length > 4 && fields[3] === productInfo.product && fields[4] === productInfo.level;
    });

    if (targetLineIndex === -1) return null;

    const startByte = startBytes[targetLineIndex];
    let endByte = ''; // Open-ended for the last message
    for (let i = targetLineIndex + 1; i < startBytes.length; i++) {
        if (startBytes[i] !== null) {
            endByte = String(startBytes[i] - 1);
            break;
        }
    }
    return { start: startByte, end: endByte };
}

/**
 * Uses the WASM module to decode a GRIB message buffer.
 * @param {ArrayBuffer} gribMessageBuffer - The buffer for a single GRIB message.
 * @returns {object|null} The decoded data including metadata and values, or null on failure.
 */
function processGribData(gribMessageBuffer) {
    const dataPtr = Module._malloc(gribMessageBuffer.byteLength);
    if (dataPtr === 0) {
        console.error("WASM _malloc failed to allocate memory.");
        return null;
    }
    
    try {
        Module.HEAPU8.set(new Uint8Array(gribMessageBuffer), dataPtr);
        const resultPtr = Module.ccall('process_grib_field', 'number', ['number', 'number', 'number'], [dataPtr, gribMessageBuffer.byteLength, 1]);

        if (resultPtr === 0) {
            console.error("C function 'process_grib_field' returned a NULL pointer.");
            return null;
        }

        const metadataJsonPtr = Module.getValue(resultPtr, '*');
        const metadataJsonLen = Module.getValue(resultPtr + 4, 'i32');
        const dataArrayPtr = Module.getValue(resultPtr + 8, '*');
        const numPoints = Module.getValue(resultPtr + 16, 'i32');

        const metadata = JSON.parse(Module.UTF8ToString(metadataJsonPtr, metadataJsonLen));
        const values = new Float32Array(Module.HEAPU8.buffer, dataArrayPtr, numPoints).slice();
        
        Module.ccall('free_result_memory', null, ['number'], [resultPtr]);
        return { metadata, values };

    } catch (e) {
        console.error("Error during WASM processing:", e);
        return null;
    } finally {
        Module._free(dataPtr);
    }
}


// --- UI AND MAP RENDERING ---

function populateProductSelector() {
    domElements.productSelector.innerHTML = '';
    for (const key in AVAILABLE_PRODUCTS) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = AVAILABLE_PRODUCTS[key].name;
        domElements.productSelector.appendChild(option);
    }
    domElements.productSelector.value = appState.selectedProduct;
}

function setupTimeSlider() {
    const startTime = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
    const endTime = startTime + (72 * 60 * 60 * 1000); // 3 days
    const step = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

    domElements.timelineSlider.min = startTime;
    domElements.timelineSlider.max = endTime;
    domElements.timelineSlider.step = step;
    domElements.timelineSlider.value = startTime;
    
    appState.selectedTimestamp = startTime;
    updateTimeDisplay();
}

function updateTimeDisplay() {
    const selectedDate = new Date(parseInt(domElements.timelineSlider.value));
    domElements.forecastHourDisplay.textContent = selectedDate.toUTCString();
}

function setupEventListeners() {
    domElements.timelineSlider.addEventListener('input', () => {
        appState.selectedTimestamp = parseInt(domElements.timelineSlider.value);
        updateTimeDisplay();
    });

    domElements.timelineSlider.addEventListener('change', () => {
        appState.selectedTimestamp = parseInt(domElements.timelineSlider.value);
        fetchAndDisplayData();
    });

    domElements.productSelector.addEventListener('change', (e) => {
        appState.selectedProduct = e.target.value;
        fetchAndDisplayData();
    });
}

/**
 * Renders the decoded weather data onto a canvas and overlays it on the map.
 * This function now remaps the data grid to match Leaflet's coordinate system.
 * @param {{metadata: object, values: Float32Array}} decodedData - The data from the WASM module.
 */
async function renderDataOnMap(decodedData) {
    const { metadata, values } = decodedData;
    const { nx, ny } = metadata.grid;

    if (!nx || !ny || nx <= 0 || ny <= 0) {
        console.error("Invalid grid dimensions:", metadata.grid);
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(nx, ny);

    const productConfig = AVAILABLE_PRODUCTS[appState.selectedProduct];
    const colorScale = productConfig.colorScale;

    // The GFS data has longitude from 0 to 359. We need to remap this to -180 to 180
    // for Leaflet. We'll "cut" the data at the 180-degree meridian.
    const halfWidth = nx / 2;
    const remappedValues = new Float32Array(values.length);

    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const oldIndex = j * nx + i;
            let newI;

            // Pixels from 180 to 359 degrees (the right half of the GFS grid)
            // will become the left half of our new map (-180 to 0).
            if (i >= halfWidth) {
                newI = i - halfWidth;
            } 
            // Pixels from 0 to 179 degrees (the left half of the GFS grid)
            // will become the right half of our new map (0 to 180).
            else {
                newI = i + halfWidth;
            }
            const newIndex = j * nx + newI;
            remappedValues[newIndex] = values[oldIndex];
        }
    }
    
    // Draw the remapped data to the canvas.
    for (let i = 0; i < remappedValues.length; i++) {
        const color = colorScale(remappedValues[i]);
        const pixelIndex = i * 4;
        imageData.data[pixelIndex] = color[0];     // R
        imageData.data[pixelIndex + 1] = color[1]; // G
        imageData.data[pixelIndex + 2] = color[2]; // B
        imageData.data[pixelIndex + 3] = 150;      // Alpha (semi-transparent)
    }
    ctx.putImageData(imageData, 0, 0);

    // Now that the data is correctly ordered, we can use standard global bounds.
    const bounds = [[-90, -180], [90, 180]];
    const imageUrl = canvas.toDataURL();

    if (appState.dataOverlay) {
        appState.map.removeLayer(appState.dataOverlay);
    }
    
    appState.dataOverlay = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.7,
        interactive: false
    }).addTo(appState.map);
}


// --- APPLICATION ENTRY POINT ---
window.addEventListener('wasmReady', initializeApp);
