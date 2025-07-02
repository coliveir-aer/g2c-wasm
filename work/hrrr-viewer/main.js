// --- CONSTANTS AND CONFIGURATION ---

// Base URL for the NOAA HRRR S3 bucket.
const S3_BUCKET_URL = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/';

// The HRRR product type to be used. 'wrfsfc' is 2D surface fields.
const HRRR_PRODUCT_TYPE = 'wrfsfc'; 

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
import { loadCityData, drawCityMarkers, getTemperatureAtLocation } from './cities.js';

// --- APPLICATION STATE ---
const appState = {
    hrrrRun: { date: null, cycle: -1 },
    selectedTimestamp: 0,
    selectedProduct: 'reflectivity_comp',
    isFetching: false,
    lastDecodedData: null,
    timeDisplayMode: 'local', // 'local' or 'utc'
    statesGeoJSON: null,
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

// --- CUSTOM PROJECTION LOGIC ---
export const projection = (function() {
    // Official HRRR Projection Parameters from NOAA.
    const R = 6371229;    // Radius of the Earth in meters
    const lat_1 = 25.0;   // Standard parallel
    const lon_0 = -97.5;  // Central meridian
    const lat_0 = 38.5;   // Latitude of origin

    const deg2rad = Math.PI / 180;

    const n = Math.sin(lat_1 * deg2rad);
    const F = (Math.cos(lat_1 * deg2rad) * Math.pow(Math.tan(Math.PI / 4 + (lat_1 * deg2rad) / 2), n)) / n;
    const rho_0 = R * F / Math.pow(Math.tan(Math.PI / 4 + (lat_0 * deg2rad) / 2), n);

    // Grid properties
    const nx = 1799;
    const ny = 1059;
    const dx = 3000;
    const dy = 3000;
    
    // Coordinates of the first grid point (bottom-left corner) in meters, which is the origin of the grid.
    const x_origin = -2697000.0;
    const y_origin = -1587000.0;

    return function(lonlat) {
        const lon = lonlat[0];
        const lat = lonlat[1];

        const rho = R * F / Math.pow(Math.tan(Math.PI / 4 + (lat * deg2rad) / 2), n);
        const theta = n * ((lon - lon_0) * deg2rad);

        // Calculate projected coordinates relative to the projection's center
        const x = rho * Math.sin(theta);
        const y = rho_0 - rho * Math.cos(theta);

        // Translate coordinates to be relative to the grid's bottom-left origin, then find the pixel.
        const i = (x - x_origin) / dx;
        const j = (y - y_origin) / dy;

        // The grid y-coordinate is inverted relative to the canvas y-coordinate.
        return [i, ny - j];
    };
})();


// --- TIME-STEPPING HELPER ---

function getSnappedTimestamp(timestamp) {
    const runTimestamp = appState.hrrrRun.date.getTime() + (appState.hrrrRun.cycle * 60 * 60 * 1000);
    const hourInMs = 60 * 60 * 1000;
    const forecastHour = (timestamp - runTimestamp) / hourInMs;
    const snappedHour = Math.round(forecastHour);
    return runTimestamp + (snappedHour * hourInMs);
}

function updateTimelineStep() {
    domElements.timelineSlider.step = 60 * 60 * 1000; // 1 hour
}


// --- CORE APPLICATION LOGIC ---

async function initializeApp() {
    console.log('Initializing application...');
    await loadCityData();
    
    try {
        // Fetch high-resolution state boundaries from a reliable online source.
        const response = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lakes.geojson');
        const allStates = await response.json();
        // Filter the GeoJSON to only include US states.
        allStates.features = allStates.features.filter(feature => feature.properties.iso_a2 === 'US');
        appState.statesGeoJSON = allStates;
    } catch (e) {
        console.error("Failed to load states.json from external source:", e);
    }

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

async function findLatestHrrrRun() {
    let currentDate = new Date();
    const checkHour = 'f18'; 
    for (let i = 0; i < 48; i++) {
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
        currentDate.setUTCHours(currentDate.getUTCHours() - 1);
    }
    return null;
}

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
        const hourStr = forecastHour.toString().padStart(2, '0');
        const fileName = `hrrr.t${cycleStr}z.${HRRR_PRODUCT_TYPE}f${hourStr}.grib2`;
        const dataPath = `hrrr.${dateStr}/conus/${fileName}`;
        const idxUrl = `${S3_BUCKET_URL}${dataPath}.idx`;
        const gribUrl = `${S3_BUCKET_URL}${dataPath}`;

        const idxResponse = await fetch(idxUrl);
        if (!idxResponse.ok) throw new Error(`Could not fetch index for F${hourStr}: ${idxResponse.statusText}`);
        const indexText = await idxResponse.text();

        const productInfo = AVAILABLE_PRODUCTS[appState.selectedProduct];
        const byteRange = findMessageInIndex(indexText, productInfo);
        if (!byteRange) throw new Error(`Could not find ${productInfo.name} in index file for F${hourStr}.`);

        const gribResponse = await fetch(gribUrl, { headers: { 'Range': `bytes=${byteRange.start}-${byteRange.end}` } });
        if (!gribResponse.ok) throw new Error(`Byte range fetch failed for F${hourStr}: ${gribResponse.statusText}`);
        
        const gribMessageBuffer = await gribResponse.arrayBuffer();
        const decodedData = processGribData(gribMessageBuffer);
        if (!decodedData) throw new Error('WASM module failed to decode data.');
        
        appState.lastDecodedData = decodedData;
        await renderDataOnCanvas(decodedData);
        console.log(`Displaying HRRR Run: ${new Date(runTimestamp).toUTCString()}`);
    } catch (error) {
        console.error('Error in fetchAndDisplayData:', error);
        appState.lastDecodedData = null;
    } finally {
        appState.isFetching = false;
    }
}

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

function processGribData(gribMessageBuffer) {
    const dataPtr = Module._malloc(gribMessageBuffer.byteLength);
    if (!dataPtr) { console.error("WASM _malloc failed."); return null; }
    try {
        Module.HEAPU8.set(new Uint8Array(gribMessageBuffer), dataPtr);
        const resultPtr = Module.ccall('process_grib_field', 'number', ['number', 'number', 'number'], [dataPtr, gribMessageBuffer.byteLength, 1]);
        if (!resultPtr) { console.error("C function 'process_grib_field' returned a NULL pointer."); return null; }
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
    const endTime = startTime + (48 * 60 * 60 * 1000);
    const now = Date.now();
    let initialTime = startTime;
    if (now > startTime) initialTime = getSnappedTimestamp(now);
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
    let timeString = appState.timeDisplayMode === 'local' ?
        selectedDate.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) :
        selectedDate.toUTCString();
    domElements.forecastDisplay.innerHTML = `<div id="forecast-display-content"><span id="forecast-hour-display">${timeString}</span><div id="time-toggle"><span class="toggle-label toggle-label-local">Local</span><label class="switch"><input type="checkbox" id="time-zone-toggle"><span class="slider round"></span></label><span class="toggle-label toggle-label-utc">UTC</span></div></div>`;
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
        const newTimestamp = getSnappedTimestamp(parseInt(domElements.timelineSlider.value, 10) + (direction * parseInt(domElements.timelineSlider.step, 10)));
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

async function renderDataOnCanvas(decodedData) {
    const nx = 1799;
    const ny = 1059;
    const { values } = decodedData;

    if (values.length !== nx * ny) {
        console.error("Data length mismatch.", { expected: nx * ny, received: values.length });
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d');
    
    // Enable anti-aliasing for smoother lines
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const imageData = ctx.createImageData(nx, ny);
    const productConfig = AVAILABLE_PRODUCTS[appState.selectedProduct];
    const colorScale = productConfig.colorScale;

    let displayMin, displayMax, displayUnit, displayColorScale, labelIncrement = null;

    const processPixel = (value, i) => {
        const color = displayColorScale(value);
        const pixelIndex = i * 4;
        if (color) {
            imageData.data[pixelIndex] = color[0];
            imageData.data[pixelIndex + 1] = color[1];
            imageData.data[pixelIndex + 2] = color[2];
            imageData.data[pixelIndex + 3] = 200;
        } else {
            imageData.data[pixelIndex + 3] = 0; // Make non-data transparent
        }
    };

    const renderLoop = (transform) => {
        for (let i = 0; i < values.length; i++) {
            const y = Math.floor(i / nx);
            const x = i % nx;
            const sourceIndex = (ny - 1 - y) * nx + x;
            processPixel(transform(values[sourceIndex]), i);
        }
    };

    if (appState.selectedProduct === 'temp_2m') {
        const kToF = (k) => (k - 273.15) * 9/5 + 32;
        displayMin = -20; displayMax = 110; displayUnit = '°F'; labelIncrement = 10;
        displayColorScale = (f) => colorScale( (f - 32) * 5/9 + 273.15 );
        renderLoop(kToF);
    } else {
        displayMin = 5; displayMax = 75; displayUnit = 'dBZ'; labelIncrement = 10;
        displayColorScale = (val) => colorScale(val);
        renderLoop(val => val);
    }
    
    ctx.putImageData(imageData, 0, 0);

    // Draw state boundaries
    if (appState.statesGeoJSON) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        appState.statesGeoJSON.features.forEach(feature => {
            const geom = feature.geometry;
            const drawRing = (ring) => {
                ctx.beginPath();
                ring.forEach((point, index) => {
                    const [x, y] = projection(point);
                    if (index === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
            };

            if (geom.type === 'Polygon') {
                geom.coordinates.forEach(drawRing);
            } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach(polygon => polygon.forEach(drawRing));
            }
        });
    }

    // Draw city markers if applicable
    if (appState.selectedProduct === 'temp_2m') {
        drawCityMarkers(ctx, appState, projection);
    }

    // Update the colorbar
    updateColorBar(document.getElementById('ui-container'), displayColorScale, displayMin, displayMax, productConfig.name, displayUnit, labelIncrement);
    
    // Display the final canvas
    domElements.map.innerHTML = '';
    domElements.map.appendChild(canvas);
}

// --- APPLICATION ENTRY POINT ---
window.addEventListener('wasmReady', initializeApp);
