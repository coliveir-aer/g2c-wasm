// --- CONSTANTS AND CONFIGURATION ---

// Base URL for the NOAA HRRR S3 bucket.
const S3_BUCKET_URL = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/';

// The HRRR product type to be used. 'wrfsfc' is 2D surface fields.
const HRRR_PRODUCT_TYPE = 'wrfsfc'; 

// Define the corner points of the HRRR grid in its native projection (meters).
// These values are specific to the HRRR CONUS grid and are derived from its definition.
const hrrr_proj_extents = {
    southwest: [-2786000, -1640000],
    northeast: [2698000, 1468000]
};

// Definition of the weather products we want to make available.
const AVAILABLE_PRODUCTS = {
    'reflectivity_comp': {
        name: 'Composite Reflectivity',
        product: 'REFC',
        level: 'entire atmosphere',
        unit: 'dBZ',
        minForecastHour: 0,
        colorScale: (value) => {
            if (value < 5) return null; // Transparent for low values
            const stops = [
                { val: 5,  rgb: [0, 150, 150] }, // Light Cyan
                { val: 15, rgb: [0, 100, 200] }, // Blue
                { val: 25, rgb: [0, 200, 0] },   // Green
                { val: 35, rgb: [255, 255, 0] }, // Yellow
                { val: 45, rgb: [255, 150, 0] }, // Orange
                { val: 55, rgb: [255, 0, 0] },   // Red
                { val: 65, rgb: [200, 0, 100] }, // Magenta
                { val: 75, rgb: [255, 255, 255] }  // White
            ];

            if (value <= stops[0].val) return stops[0].rgb;
            if (value >= stops[stops.length - 1].val) return stops[stops.length - 1].rgb;

            for (let i = 0; i < stops.length - 1; i++) {
                const start = stops[i];
                const end = stops[i + 1];
                if (value >= start.val && value < end.val) {
                    const t = (value - start.val) / (end.val - start.val);
                    const r = Math.round(start.rgb[0] + t * (end.rgb[0] - start.rgb[0]));
                    const g = Math.round(start.rgb[1] + t * (end.rgb[1] - start.rgb[1]));
                    const b = Math.round(start.rgb[2] + t * (end.rgb[2] - start.rgb[2]));
                    return [r, g, b];
                }
            }
            return stops[stops.length - 1].rgb;
        }
    },
    'temp_2m': {
        name: '2m Temperature',
        product: 'TMP',
        level: '2 m above ground',
        unit: 'K',
        minForecastHour: 0,
        colorScale: (value) => {
            const stops = [
                { val: 250, rgb: [0, 0, 139] },   // Dark Blue
                { val: 260, rgb: [0, 0, 255] },   // Blue
                { val: 270, rgb: [0, 255, 255] }, // Cyan
                { val: 280, rgb: [0, 255, 0] },   // Green
                { val: 290, rgb: [255, 255, 0] }, // Yellow
                { val: 300, rgb: [255, 165, 0] }, // Orange
                { val: 310, rgb: [255, 0, 0] },   // Red
                { val: 315, rgb: [139, 0, 0] }    // Dark Red
            ];

            if (value <= stops[0].val) return stops[0].rgb;
            if (value >= stops[stops.length - 1].val) return stops[stops.length - 1].rgb;

            for (let i = 0; i < stops.length - 1; i++) {
                const start = stops[i];
                const end = stops[i + 1];
                if (value >= start.val && value < end.val) {
                    const t = (value - start.val) / (end.val - start.val);
                    const r = Math.round(start.rgb[0] + t * (end.rgb[0] - start.rgb[0]));
                    const g = Math.round(start.rgb[1] + t * (end.rgb[1] - start.rgb[1]));
                    const b = Math.round(start.rgb[2] + t * (end.rgb[2] - start.rgb[2]));
                    return [r, g, b];
                }
            }
            return stops[stops.length - 1].rgb;
        }
    }
};

// --- MODULE IMPORTS ---
import { updateColorBar } from './colorbar.js';
import { loadCityData, updateCityMarkers, clearCityMarkers } from './cities.js';

// --- APPLICATION STATE ---
const appState = {
    hrrrRun: { date: null, cycle: -1 },
    selectedTimestamp: 0,
    selectedProduct: 'reflectivity_comp',
    map: null,
    dataOverlay: null,
    isFetching: false,
    lastDecodedData: null,
    timeDisplayMode: 'local', // 'local' or 'utc'
};


// --- DOM ELEMENT REFERENCES ---
const domElements = {
    map: document.getElementById('map'),
    productSelector: document.getElementById('product-selector'),
    timelineSlider: document.getElementById('timeline-slider'),
    forecastDisplay: document.getElementById('forecast-display'),
    stepBackwardBtn: document.getElementById('time-step-backward'),
    stepForwardBtn: document.getElementById('time-step-forward'),
    loadForecastBtn: document.getElementById('load-forecast-btn'),
};


// --- TIME-STEPPING HELPER ---

/**
 * Snaps a given timestamp to the nearest valid HRRR forecast interval.
 * @param {number} timestamp - The timestamp to snap.
 * @returns {number} The snapped timestamp.
 */
function getSnappedTimestamp(timestamp) {
    const runTimestamp = appState.hrrrRun.date.getTime() + (appState.hrrrRun.cycle * 60 * 60 * 1000);
    const hourInMs = 60 * 60 * 1000;
    
    const forecastHour = (timestamp - runTimestamp) / hourInMs;
    // HRRR is hourly
    const snappedHour = Math.round(forecastHour);
    
    return runTimestamp + (snappedHour * hourInMs);
}

/**
 * Updates the step attribute of the timeline slider. HRRR is always hourly.
 */
function updateTimelineStep() {
    const hourInMs = 60 * 60 * 1000;
    domElements.timelineSlider.step = hourInMs; // 1 hour
}


// --- CORE APPLICATION LOGIC ---

/**
 * Initializes the entire application.
 */
async function initializeApp() {
    console.log('Initializing application...');
    const mapContainer = document.getElementById('map');
    console.log(`Map container dimensions before init: ${mapContainer.offsetWidth}x${mapContainer.offsetHeight}`);

    // Define the HRRR Lambert Conformal projection using its Proj4 string.
    const hrrrProjection = '+proj=lcc +lat_1=25.0 +lat_2=25.0 +lat_0=25.0 +lon_0=-95.0 +x_0=0 +y_0=0 +a=6371200 +b=6371200 +units=m +no_defs';

    // Define the coordinate bounds of the HRRR grid in its native projection units (meters).
    const hrrrBounds = L.bounds(
        L.point(hrrr_proj_extents.southwest[0], hrrr_proj_extents.southwest[1]),
        L.point(hrrr_proj_extents.northeast[0], hrrr_proj_extents.northeast[1])
    );

    // Create a new Leaflet Coordinate Reference System (CRS) using the Proj4 definition.
    const crs = new L.Proj.CRS('EPSG:32767', hrrrProjection, {
        resolutions: [ 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1 ],
        bounds: hrrrBounds
    });

    // Initialize Leaflet map with the custom HRRR projection.
    appState.map = L.map(domElements.map, {
        crs: crs,
        worldCopyJump: true,
        zoomControl: false, 
        attributionControl: false,
    }).setView([39.8, -98.5], 3); 
    
    // Add a compatible WMS tile layer from USGS that supports the necessary projection.
    L.tileLayer.wms('https://basemap.nationalmap.gov/arcgis/services/USGSTopo/MapServer/WmsServer', {
        layers: '0',
        format: 'image/png',
        transparent: true,
        crs: crs, // Use the custom HRRR CRS
        attribution: 'USGS The National Map'
    }).addTo(appState.map);
    
    L.control.zoom({ position: 'topright' }).addTo(appState.map);
    
    appState.map.createPane('cityLabels');
    appState.map.getPane('cityLabels').style.zIndex = 650;
    
    await loadCityData();

    const latestRun = await findLatestHrrrRun();
    if (!latestRun) {
        console.error('Error: Could not find any recent HRRR model runs.');
        return;
    }
    appState.hrrrRun = latestRun;
    console.log(`Latest HRRR run found: ${latestRun.date.toISOString().slice(0, 10)} ${latestRun.cycle}Z`);

    populateProductSelector();
    setupTimeSlider();
    setupEventListeners();
    fetchAndDisplayData();
}

/**
 * Probes the S3 bucket to find the most recent HRRR model run.
 */
async function findLatestHrrrRun() {
    let currentDate = new Date(); // Start with the current time
    // Check for a file at hour 18 to have high confidence the run is complete.
    const checkHour = 'f18'; 

    for (let i = 0; i < 48; i++) { // Check back up to 48 hours
        const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        const cycle = currentDate.getUTCHours();
        const cycleStr = cycle.toString().padStart(2, '0');
        
        const testUrl = `${S3_BUCKET_URL}hrrr.${dateStr}/conus/hrrr.t${cycleStr}z.${HRRR_PRODUCT_TYPE}${checkHour}.grib2.idx`;
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
        
        // Go back one hour
        currentDate.setUTCHours(currentDate.getUTCHours() - 1);
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
    console.log('Fetching data...');

    try {
        const runTimestamp = appState.hrrrRun.date.getTime() + (appState.hrrrRun.cycle * 60 * 60 * 1000);
        let forecastHour = Math.round((appState.selectedTimestamp - runTimestamp) / (60 * 60 * 1000));

        const dateStr = appState.hrrrRun.date.toISOString().slice(0, 10).replace(/-/g, '');
        const cycleStr = appState.hrrrRun.cycle.toString().padStart(2, '0');
        const hourStr = forecastHour.toString().padStart(2, '0'); // HRRR uses 2 digits for forecast hour
        
        const fileName = `hrrr.t${cycleStr}z.${HRRR_PRODUCT_TYPE}f${hourStr}.grib2`;
        const dataPath = `hrrr.${dateStr}/conus/${fileName}`;
        const idxUrl = `${S3_BUCKET_URL}${dataPath}.idx`;
        const gribUrl = `${S3_BUCKET_URL}${dataPath}`;

        console.log('Fetching GRIB index...');
        const idxResponse = await fetch(idxUrl);
        if (!idxResponse.ok) throw new Error(`Could not fetch index for F${hourStr}: ${idxResponse.statusText}`);
        const indexText = await idxResponse.text();

        const productInfo = AVAILABLE_PRODUCTS[appState.selectedProduct];
        const byteRange = findMessageInIndex(indexText, productInfo);
        if (!byteRange) throw new Error(`Could not find ${productInfo.name} in index file for F${hourStr}.`);

        console.log('Fetching GRIB message...');
        const gribResponse = await fetch(gribUrl, {
            headers: { 'Range': `bytes=${byteRange.start}-${byteRange.end}` }
        });
        if (!gribResponse.ok) throw new Error(`Byte range fetch failed for F${hourStr}: ${gribResponse.statusText}`);
        const gribMessageBuffer = await gribResponse.arrayBuffer();

        console.log('Decoding with WASM...');
        const decodedData = processGribData(gribMessageBuffer);
        if (!decodedData) throw new Error('WASM module failed to decode data.');
        
        appState.lastDecodedData = decodedData;
        
        console.log('Rendering map overlay...');
        await renderDataOnMap(decodedData);
        
        console.log(`Displaying HRRR Run: ${new Date(runTimestamp).toUTCString()}`);

    } catch (error) {
        console.error('Error in fetchAndDisplayData:', error);
        appState.lastDecodedData = null;
        clearCityMarkers();
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
    const currentSelection = domElements.productSelector.value || appState.selectedProduct;
    domElements.productSelector.innerHTML = '';
    Object.keys(AVAILABLE_PRODUCTS).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = AVAILABLE_PRODUCTS[key].name;
        domElements.productSelector.appendChild(option);
    });
    domElements.productSelector.value = currentSelection;
}

function setupTimeSlider() {
    const startTime = appState.hrrrRun.date.getTime() + (appState.hrrrRun.cycle * 60 * 60 * 1000);
    const endTime = startTime + (48 * 60 * 60 * 1000); // 48-hour forecast for HRRR
    
    const now = Date.now();
    let initialTime = startTime;
    if (now > startTime) {
        initialTime = getSnappedTimestamp(now);
    }
    
    initialTime = Math.min(initialTime, endTime);

    domElements.timelineSlider.min = startTime;
    domElements.timelineSlider.max = endTime;
    
    appState.selectedTimestamp = initialTime;
    domElements.timelineSlider.value = initialTime;
    
    updateTimelineStep();
    updateTimeDisplay();
}

function updateTimeDisplay() {
    const selectedDate = new Date(parseInt(domElements.timelineSlider.value));
    
    let timeString;
    if (appState.timeDisplayMode === 'local') {
        const options = {
            weekday: 'short', month: 'short', day: 'numeric', 
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
        };
        timeString = selectedDate.toLocaleString(undefined, options);
    } else {
        timeString = selectedDate.toUTCString();
    }

    domElements.forecastDisplay.innerHTML = `
        <div id="forecast-display-content">
            <span id="forecast-hour-display">${timeString}</span>
            <div id="time-toggle">
                <span class="toggle-label toggle-label-local">Local</span>
                <label class="switch">
                    <input type="checkbox" id="time-zone-toggle">
                    <span class="slider round"></span>
                </label>
                <span class="toggle-label toggle-label-utc">UTC</span>
            </div>
        </div>
    `;

    const toggle = document.getElementById('time-zone-toggle');
    toggle.checked = appState.timeDisplayMode === 'utc';
    document.querySelector('.toggle-label-local').classList.toggle('active', appState.timeDisplayMode === 'local');
    document.querySelector('.toggle-label-utc').classList.toggle('active', appState.timeDisplayMode === 'utc');
    
    toggle.addEventListener('change', (e) => {
        appState.timeDisplayMode = e.target.checked ? 'utc' : 'local';
        updateTimeDisplay();
    });
}

function setupEventListeners() {
    domElements.timelineSlider.addEventListener('input', () => {
        appState.selectedTimestamp = parseInt(domElements.timelineSlider.value);
        updateTimeDisplay();
    });

    domElements.loadForecastBtn.addEventListener('click', () => {
        const snappedTime = getSnappedTimestamp(appState.selectedTimestamp);
        appState.selectedTimestamp = snappedTime;
        domElements.timelineSlider.value = snappedTime;
        updateTimeDisplay();
        fetchAndDisplayData();
    });

    const stepTime = (direction) => {
        const currentStep = parseInt(domElements.timelineSlider.step, 10);
        const currentValue = parseInt(domElements.timelineSlider.value, 10);
        const snappedValue = getSnappedTimestamp(currentValue);
        let newTimestamp = snappedValue + (direction * currentStep);
        newTimestamp = getSnappedTimestamp(newTimestamp);

        domElements.timelineSlider.value = newTimestamp;
        appState.selectedTimestamp = newTimestamp;
        updateTimeDisplay();
        fetchAndDisplayData();
    };

    domElements.stepBackwardBtn.addEventListener('click', () => stepTime(-1));
    domElements.stepForwardBtn.addEventListener('click', () => stepTime(1));

    domElements.productSelector.addEventListener('change', (e) => {
        appState.selectedProduct = e.target.value;
        const snappedTime = getSnappedTimestamp(appState.selectedTimestamp);
        appState.selectedTimestamp = snappedTime;
        domElements.timelineSlider.value = snappedTime;
        updateTimeDisplay();
        fetchAndDisplayData();
    });
}

/**
 * Renders the decoded weather data onto a canvas and overlays it on the map.
 * @param {{metadata: object, values: Float32Array}} decodedData - The data from the WASM module.
 */
async function renderDataOnMap(decodedData) {
    const { metadata, values } = decodedData;
    const { nx, ny } = metadata.grid;

    if (!nx || !ny) {
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
    
    // The data is already in the correct grid projection, no remapping needed for HRRR.
    for (let i = 0; i < values.length; i++) {
        const color = colorScale(values[i]);
        const pixelIndex = i * 4;
        if (color) {
            imageData.data[pixelIndex] = color[0];
            imageData.data[pixelIndex + 1] = color[1];
            imageData.data[pixelIndex + 2] = color[2];
            imageData.data[pixelIndex + 3] = 180; // Opacity
        } else {
            imageData.data[pixelIndex + 3] = 0; // Transparent
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    updateColorBar(appState.map, colorScale, 5, 75, productConfig.name, productConfig.unit, 10);
    
    // Use proj4 to transform the projected corner points to Lat/Lon
    const hrrrProjection = '+proj=lcc +lat_1=25.0 +lat_2=25.0 +lat_0=25.0 +lon_0=-95.0 +x_0=0 +y_0=0 +a=6371200 +b=6371200 +units=m +no_defs';
    const southwest_ll = proj4(hrrrProjection, 'WGS84', hrrr_proj_extents.southwest);
    const northeast_ll = proj4(hrrrProjection, 'WGS84', hrrr_proj_extents.northeast);

    const bounds = L.latLngBounds(
        [southwest_ll[1], southwest_ll[0]],
        [northeast_ll[1], northeast_ll[0]]
    );

    const imageUrl = canvas.toDataURL();

    if (appState.dataOverlay) {
        appState.map.removeLayer(appState.dataOverlay);
    }
    
    appState.dataOverlay = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.7,
        interactive: false
    }).addTo(appState.map);

    // City markers are not applicable to the HRRR projection in this context.
    clearCityMarkers();
}


// --- APPLICATION ENTRY POINT ---
window.addEventListener('wasmReady', initializeApp);
