// --- CONSTANTS AND CONFIGURATION ---

// Base URL for the NOAA GFS S3 bucket.
const S3_BUCKET_URL = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/';

// The GFS product type to be used. 'pgrb2.0p25' is 0.25 degree, 'pgrb2.1p00' is 1.00 degree.
const GFS_PRODUCT_TYPE = 'pgrb2.1p00'; 

// Definition of the weather products we want to make available.
const AVAILABLE_PRODUCTS = {
    'temp_2m': {
        name: '2m Temperature',
        product: 'TMP',
        level: '2 m above ground',
        colorScale: (value) => { 
            if (value < 250) return [0, 0, 139];
            if (value < 260) return [0, 0, 255];
            if (value < 270) return [0, 255, 255];
            if (value < 280) return [0, 255, 0];
            if (value < 290) return [255, 255, 0];
            if (value < 300) return [255, 165, 0];
            if (value < 310) return [255, 0, 0];
            return [139, 0, 0];
        }
    },
};


// --- APPLICATION STATE ---
const appState = {
    gfsRun: { date: null, cycle: -1 },
    selectedTimestamp: 0,
    selectedProduct: 'temp_2m',
    map: null,
    dataOverlay: null,
    isFetching: false,
    // Experimental rendering options controlled by the debug UI
    renderingOptions: {
        remapLongitude: true,
        flipX: false,
        flipY: false,
        scale: 1.0,
        lonShift: 0
    }
};


// --- DOM ELEMENT REFERENCES ---
const domElements = {
    map: document.getElementById('map'),
    productSelector: document.getElementById('product-selector'),
    timelineSlider: document.getElementById('timeline-slider'),
    forecastHourDisplay: document.getElementById('forecast-hour-display'),
    runInfo: document.getElementById('run-info'),
    // Debug Controls
    remapLonCheckbox: document.getElementById('remap-lon-checkbox'),
    flipXCheckbox: document.getElementById('flip-x-checkbox'),
    flipYCheckbox: document.getElementById('flip-y-checkbox'),
    scaleSlider: document.getElementById('scale-slider'),
    scaleValue: document.getElementById('scale-value'),
    lonShiftSlider: document.getElementById('lon-shift-slider'),
    lonShiftValue: document.getElementById('lon-shift-value'),
};


// --- CORE APPLICATION LOGIC ---

/**
 * Initializes the entire application.
 */
async function initializeApp() {
    console.log('Initializing application...');
    domElements.runInfo.textContent = 'Finding latest GFS model run...';

    // Initialize Leaflet map with the correct projection
    appState.map = L.map(domElements.map, {
        crs: L.CRS.EPSG4326,
        worldCopyJump: true
    }).setView([20, 0], 2); 
    
    // Use a WMS tile layer from NASA GIBS that serves tiles in the correct EPSG:4326 projection.
    L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', {
        layers: 'BlueMarble_ShadedRelief_Bathymetry',
        format: 'image/jpeg',
        transparent: true,
        attribution: 'NASA GIBS'
    }).addTo(appState.map);

    const latestRun = await findLatestGfsRun();
    if (!latestRun) {
        domElements.runInfo.textContent = 'Error: Could not find any recent GFS model runs.';
        return;
    }
    appState.gfsRun = latestRun;
    console.log(`Latest GFS run found: ${latestRun.date.toISOString().slice(0, 10)} ${latestRun.cycle}Z`);

    populateProductSelector();
    setupTimeSlider();
    setupEventListeners();
    fetchAndDisplayData();
}

/**
 * Probes the NOAA S3 bucket to find the most recent GFS model run.
 */
async function findLatestGfsRun() {
    let currentDate = new Date(Date.now() + 6 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
        const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        for (const cycle of [18, 12, 6, 0]) {
            const cycleStr = cycle.toString().padStart(2, '0');
            const testUrl = `${S3_BUCKET_URL}gfs.${dateStr}/${cycleStr}/atmos/gfs.t${cycleStr}z.${GFS_PRODUCT_TYPE}.f000.idx`;
            console.log(`Checking for run: ${testUrl}`);
            try {
                const response = await fetch(testUrl, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
                if (response.status === 206) {
                    const runDate = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()));
                    return { date: runDate, cycle: cycle };
                }
            } catch (e) {
                console.warn(`Request for ${testUrl} failed, likely does not exist.`, e);
            }
        }
        currentDate.setUTCDate(currentDate.getUTCDate() - 1);
    }
    return null;
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
 */
function findMessageInIndex(indexText, productInfo) {
    const lines = indexText.split('\n');
    const startBytes = lines.map(line => parseInt(line.split(':')[1], 10));
    const targetLineIndex = lines.findIndex(line => {
        const fields = line.split(':');
        return fields.length > 4 && fields[3] === productInfo.product && fields[4] === productInfo.level;
    });

    if (targetLineIndex === -1) return null;

    const startByte = startBytes[targetLineIndex];
    let endByte = '';
    for (let i = targetLineIndex + 1; i < startBytes.length; i++) {
        if (!isNaN(startBytes[i])) {
            endByte = String(startBytes[i] - 1);
            break;
        }
    }
    return { start: startByte, end: endByte };
}

/**
 * Uses the WASM module to decode a GRIB message buffer.
 */
function processGribData(gribMessageBuffer) {
    const dataPtr = Module._malloc(gribMessageBuffer.byteLength);
    if (!dataPtr) {
        console.error("WASM _malloc failed.");
        return null;
    }
    try {
        Module.HEAPU8.set(new Uint8Array(gribMessageBuffer), dataPtr);
        const resultPtr = Module.ccall('process_grib_field', 'number', ['number', 'number', 'number'], [dataPtr, gribMessageBuffer.byteLength, 1]);
        if (!resultPtr) {
            console.error("C function 'process_grib_field' returned a NULL pointer.");
            return null;
        }
        const metadataJsonPtr = Module.getValue(resultPtr, '*');
        const metadataLen = Module.getValue(resultPtr + 4, 'i32');
        const dataPtr_ = Module.getValue(resultPtr + 8, '*');
        const numPoints = Module.getValue(resultPtr + 16, 'i32');
        const metadata = JSON.parse(Module.UTF8ToString(metadataJsonPtr, metadataLen));
        const values = new Float32Array(Module.HEAPU8.buffer, dataPtr_, numPoints).slice();
        Module.ccall('free_result_memory', null, ['number'], [resultPtr]);
        return { metadata, values };
    } finally {
        Module._free(dataPtr);
    }
}


// --- UI AND MAP RENDERING ---

function populateProductSelector() {
    domElements.productSelector.innerHTML = '';
    Object.keys(AVAILABLE_PRODUCTS).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = AVAILABLE_PRODUCTS[key].name;
        domElements.productSelector.appendChild(option);
    });
    domElements.productSelector.value = appState.selectedProduct;
}

function setupTimeSlider() {
    const startTime = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
    const endTime = startTime + (72 * 60 * 60 * 1000);
    const step = 3 * 60 * 60 * 1000;
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
    // Main UI Listeners
    domElements.timelineSlider.addEventListener('input', () => {
        appState.selectedTimestamp = parseInt(domElements.timelineSlider.value);
        updateTimeDisplay();
    });
    domElements.timelineSlider.addEventListener('change', () => fetchAndDisplayData());
    domElements.productSelector.addEventListener('change', (e) => {
        appState.selectedProduct = e.target.value;
        fetchAndDisplayData();
    });

    // Debug UI Listeners
    domElements.remapLonCheckbox.addEventListener('change', (e) => {
        appState.renderingOptions.remapLongitude = e.target.checked;
        fetchAndDisplayData();
    });
    domElements.flipXCheckbox.addEventListener('change', (e) => {
        appState.renderingOptions.flipX = e.target.checked;
        fetchAndDisplayData();
    });
    domElements.flipYCheckbox.addEventListener('change', (e) => {
        appState.renderingOptions.flipY = e.target.checked;
        fetchAndDisplayData();
    });
    domElements.scaleSlider.addEventListener('input', (e) => {
        appState.renderingOptions.scale = parseFloat(e.target.value);
        domElements.scaleValue.textContent = appState.renderingOptions.scale.toFixed(2);
    });
    domElements.scaleSlider.addEventListener('change', () => fetchAndDisplayData());
    domElements.lonShiftSlider.addEventListener('input', (e) => {
        appState.renderingOptions.lonShift = parseInt(e.target.value);
        domElements.lonShiftValue.textContent = `${appState.renderingOptions.lonShift}°`;
    });
    domElements.lonShiftSlider.addEventListener('change', () => fetchAndDisplayData());
}

/**
 * Renders the decoded weather data onto a canvas and overlays it on the map.
 * This function now remaps the data grid to match Leaflet's coordinate system.
 * @param {{metadata: object, values: Float32Array}} decodedData - The data from the WASM module.
 */
async function renderDataOnMap(decodedData) {
    const { metadata, values } = decodedData;
    const { nx, ny } = metadata.grid;

    if (!nx || !ny) {
        console.error("Invalid grid dimensions:", metadata.grid);
        return;
    }

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = nx;
    displayCanvas.height = ny;
    const displayCtx = displayCanvas.getContext('2d');
    
    // Create a temporary, off-screen canvas to hold the raw pixel data.
    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = nx;
    bufferCanvas.height = ny;
    const bufferCtx = bufferCanvas.getContext('2d');
    
    const imageData = bufferCtx.createImageData(nx, ny);
    const productConfig = AVAILABLE_PRODUCTS[appState.selectedProduct];
    const colorScale = productConfig.colorScale;

    let processedValues = values;
    let bounds;
    
    // Conditionally remap the longitude based on the debug checkbox
    if (appState.renderingOptions.remapLongitude) {
        const halfWidth = nx / 2;
        const remapped = new Float32Array(values.length);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const oldIndex = j * nx + i;
                let newI = (i < halfWidth) ? i + halfWidth : i - halfWidth;
                remapped[j * nx + newI] = values[oldIndex];
            }
        }
        processedValues = remapped;
        bounds = [[-90, -180], [90, 180]];
    } else {
        bounds = [[metadata.grid.lat_last, metadata.grid.lon_first], [metadata.grid.lat_first, metadata.grid.lon_last]];
    }

    // Draw the processed data to the buffer canvas's image buffer.
    for (let i = 0; i < processedValues.length; i++) {
        const color = colorScale(processedValues[i]);
        const pixelIndex = i * 4;
        imageData.data[pixelIndex] = color[0];     // R
        imageData.data[pixelIndex + 1] = color[1]; // G
        imageData.data[pixelIndex + 2] = color[2]; // B
        imageData.data[pixelIndex + 3] = 150;      // Alpha
    }
    bufferCtx.putImageData(imageData, 0, 0);

    // Apply debug transformations before drawing the buffer to the display canvas.
    displayCtx.save();
    const scaleX = appState.renderingOptions.flipX ? -1 : 1;
    const scaleY = appState.renderingOptions.flipY ? -1 : 1;
    const transX = appState.renderingOptions.flipX ? -nx : 0;
    const transY = appState.renderingOptions.flipY ? -ny : 0;
    displayCtx.translate(transX, transY);
    displayCtx.scale(scaleX, scaleY);
    
    // Draw the (potentially transformed) buffer canvas to the display canvas.
    displayCtx.drawImage(bufferCanvas, 0, 0);
    displayCtx.restore();

    // Apply debug scale and shift to the final bounds
    const scale = appState.renderingOptions.scale;
    const lonShift = appState.renderingOptions.lonShift;
    const centerLat = (bounds[0][0] + bounds[1][0]) / 2;
    const centerLon = (bounds[0][1] + bounds[1][1]) / 2;
    const height = Math.abs(bounds[1][0] - bounds[0][0]) * scale;
    const width = Math.abs(bounds[1][1] - bounds[0][1]) * scale;

    const finalBounds = [
        [centerLat - height/2, centerLon - width/2 + lonShift],
        [centerLat + height/2, centerLon + width/2 + lonShift]
    ];
    
    const imageUrl = displayCanvas.toDataURL();

    if (appState.dataOverlay) {
        appState.map.removeLayer(appState.dataOverlay);
    }
    
    appState.dataOverlay = L.imageOverlay(imageUrl, finalBounds, {
        opacity: 0.7,
        interactive: false
    }).addTo(appState.map);
}


// --- APPLICATION ENTRY POINT ---
window.addEventListener('wasmReady', initializeApp);
