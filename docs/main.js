// --- CONSTANTS AND CONFIGURATION ---

// Base URL for the NOAA GFS S3 bucket.
const S3_BUCKET_URL = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/';

// The GFS product type to be used. 'pgrb2.0p25' is 0.25 degree, 'pgrb2.1p00' is 1.00 degree.
const GFS_PRODUCT_TYPE = 'pgrb2.0p25'; 

// Definition of the weather products we want to make available.
const AVAILABLE_PRODUCTS = {
    'temp_2m': {
        name: '2m Temperature',
        product: 'TMP',
        level: '2 m above ground',
        unit: 'K',
        minForecastHour: 0,
        // This color scale now returns only [R, G, B] values.
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
    },
    'precip_total': {
        name: 'Total Precipitation',
        product: 'APCP',
        level: 'surface',
        unit: 'mm',
        minForecastHour: 3, // APCP is an accumulated product, not available at hour 0.
        // This color scale also returns only [R, G, B].
        // It returns null for zero precipitation, which is handled in the render function.
        colorScale: (value) => {
            if (value <= 0.1) return null; // No significant rain
            const stops = [
                { val: 1,   rgb: [144, 238, 144] }, // Very light green
                { val: 2.5, rgb: [0, 255, 0] },     // Light green
                { val: 5,   rgb: [0, 200, 0] },     // Green
                { val: 10,  rgb: [255, 255, 0] },   // Yellow
                { val: 25,  rgb: [255, 165, 0] },   // Orange
                { val: 50,  rgb: [255, 0, 0] },     // Red
                { val: 75,  rgb: [180, 0, 0] }      // Dark Red
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
    gfsRun: { date: null, cycle: -1 },
    selectedTimestamp: 0,
    selectedProduct: 'temp_2m',
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
 * Snaps a given timestamp to the nearest valid GFS forecast interval.
 * @param {number} timestamp - The timestamp to snap.
 * @returns {number} The snapped timestamp.
 */
function getSnappedTimestamp(timestamp) {
    const runTimestamp = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
    const hourInMs = 60 * 60 * 1000;
    
    const forecastHour = (timestamp - runTimestamp) / hourInMs;

    let snappedHour;
    if (GFS_PRODUCT_TYPE === 'pgrb2.0p25' && forecastHour <= 120) {
        // Hourly forecasts up to 120 hours
        snappedHour = Math.round(forecastHour);
    } else {
        // 3-hourly forecasts otherwise
        snappedHour = Math.round(forecastHour / 3) * 3;
    }
    
    return runTimestamp + (snappedHour * hourInMs);
}

/**
 * Updates the step attribute of the timeline slider based on the current product and time.
 */
function updateTimelineStep() {
    const runTimestamp = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
    const hourInMs = 60 * 60 * 1000;
    const forecastHour = (appState.selectedTimestamp - runTimestamp) / hourInMs;

    if (GFS_PRODUCT_TYPE === 'pgrb2.0p25' && forecastHour < 120) {
        domElements.timelineSlider.step = hourInMs; // 1 hour
    } else {
        domElements.timelineSlider.step = hourInMs * 3; // 3 hours
    }
}


// --- CORE APPLICATION LOGIC ---

/**
 * Initializes the entire application.
 */
async function initializeApp() {
    console.log('Initializing application...');

    // Initialize Leaflet map with the correct projection
    appState.map = L.map(domElements.map, {
        crs: L.CRS.EPSG4326,
        worldCopyJump: true,
        zoomControl: false, // Disable default zoom control
        attributionControl: false, // Disable attribution control
    }).setView([20, 0], 2); 
    
    // Add zoom control to the top right
    L.control.zoom({ position: 'topright' }).addTo(appState.map);
    
    // Create a dedicated pane for city labels to ensure they are on top.
    appState.map.createPane('cityLabels');
    appState.map.getPane('cityLabels').style.zIndex = 650;
    
    // Use a WMS tile layer from NASA GIBS that serves tiles in the correct EPSG:4326 projection.
    L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', {
        layers: 'OSM_Land_Water_Map',
        format: 'image/jpeg',
        transparent: true,
        attribution: 'NASA GIBS'
    }).addTo(appState.map);

    // Add event listeners for updating city markers on map interaction
    appState.map.on('zoomend moveend', () => {
        if (appState.selectedProduct === 'temp_2m') {
            updateCityMarkers(appState.map, appState);
        } else {
            clearCityMarkers();
        }
    });

    await loadCityData();

    const latestRun = await findLatestGfsRun();
    if (!latestRun) {
        console.error('Error: Could not find any recent GFS model runs.');
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
    // Check for a file at hour 168 to have high confidence the run is complete for a 7-day forecast.
    const checkHour = 'f168';

    for (let i = 0; i < 3; i++) {
        const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        for (const cycle of [18, 12, 6, 0]) {
            const cycleStr = cycle.toString().padStart(2, '0');
            const testUrl = `${S3_BUCKET_URL}gfs.${dateStr}/${cycleStr}/atmos/gfs.t${cycleStr}z.${GFS_PRODUCT_TYPE}.${checkHour}.idx`;
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
    console.log('Fetching data...');

    try {
        const runTimestamp = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
        
        // The selectedTimestamp is now guaranteed to be on a valid step.
        let forecastHour = Math.round((appState.selectedTimestamp - runTimestamp) / (60 * 60 * 1000));

        const dateStr = appState.gfsRun.date.toISOString().slice(0, 10).replace(/-/g, '');
        const cycleStr = appState.gfsRun.cycle.toString().padStart(2, '0');
        const hourStr = forecastHour.toString().padStart(3, '0');
        
        const fileName = `gfs.t${cycleStr}z.${GFS_PRODUCT_TYPE}.f${hourStr}`;
        const s3Path = `gfs.${dateStr}/${cycleStr}/atmos/${fileName}`;
        const idxUrl = `${S3_BUCKET_URL}${s3Path}.idx`;

        console.log('Fetching GRIB index...');
        const idxResponse = await fetch(idxUrl);
        if (!idxResponse.ok) throw new Error(`Could not fetch index for F${hourStr}: ${idxResponse.statusText}`);
        const indexText = await idxResponse.text();

        const productInfo = AVAILABLE_PRODUCTS[appState.selectedProduct];
        const byteRange = findMessageInIndex(indexText, productInfo);
        if (!byteRange) throw new Error(`Could not find ${productInfo.name} in index file for F${hourStr}.`);

        console.log('Fetching GRIB message...');
        const gribResponse = await fetch(`${S3_BUCKET_URL}${s3Path}`, {
            headers: { 'Range': `bytes=${byteRange.start}-${byteRange.end}` }
        });
        if (!gribResponse.ok) throw new Error(`Byte range fetch failed for F${hourStr}: ${gribResponse.statusText}`);
        const gribMessageBuffer = await gribResponse.arrayBuffer();

        console.log('Decoding with WASM...');
        const decodedData = processGribData(gribMessageBuffer);
        if (!decodedData) throw new Error('WASM module failed to decode data.');
        
        appState.lastDecodedData = decodedData; // Store for city markers
        
        console.log('Rendering map overlay...');
        await renderDataOnMap(decodedData);
        
        console.log(`Displaying GFS Run: ${new Date(runTimestamp).toUTCString()}`);

    } catch (error) {
        console.error('Error in fetchAndDisplayData:', error);
        appState.lastDecodedData = null; // Clear data on error
        clearCityMarkers(); // Clear markers on error
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
    const startTime = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
    const endTime = startTime + (168 * 60 * 60 * 1000); // 7-day forecast
    
    // Calculate the initial forecast time closest to the user's current time.
    const now = Date.now();
    let initialTime = startTime;
    if (now > startTime) {
        // Snap the current time to the nearest valid forecast step.
        initialTime = getSnappedTimestamp(now);
    }
    
    // Ensure the initial time does not exceed the forecast range.
    initialTime = Math.min(initialTime, endTime);

    domElements.timelineSlider.min = startTime;
    domElements.timelineSlider.max = endTime;
    
    appState.selectedTimestamp = initialTime;
    domElements.timelineSlider.value = initialTime;
    
    updateTimelineStep(); // Set the initial correct step
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

    // Re-attach event listener and set state for the newly created toggle
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
    // Fires continuously while the user drags the slider.
    domElements.timelineSlider.addEventListener('input', () => {
        appState.selectedTimestamp = parseInt(domElements.timelineSlider.value);
        updateTimelineStep(); // Update step dynamically for 0.25deg product
        updateTimeDisplay();
    });

    domElements.loadForecastBtn.addEventListener('click', () => {
        // Snap the timestamp before loading
        const snappedTime = getSnappedTimestamp(appState.selectedTimestamp);
        appState.selectedTimestamp = snappedTime;
        domElements.timelineSlider.value = snappedTime;
        updateTimeDisplay();
        fetchAndDisplayData();
    });

    const stepTime = (direction) => {
        const currentStep = parseInt(domElements.timelineSlider.step, 10);
        const currentValue = parseInt(domElements.timelineSlider.value, 10);
        
        // Ensure current value is on a valid step before adding/subtracting
        const snappedValue = getSnappedTimestamp(currentValue);

        let newTimestamp = snappedValue + (direction * currentStep);
        
        // After stepping, snap again in case we crossed the 120h boundary
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
        
        const productInfo = AVAILABLE_PRODUCTS[appState.selectedProduct];
        const runTimestamp = appState.gfsRun.date.getTime() + (appState.gfsRun.cycle * 60 * 60 * 1000);
        const currentForecastHour = Math.round((appState.selectedTimestamp - runTimestamp) / (60 * 60 * 1000));

        if (currentForecastHour < productInfo.minForecastHour) {
            const newTimestamp = runTimestamp + (productInfo.minForecastHour * 60 * 60 * 1000);
            appState.selectedTimestamp = newTimestamp;
            domElements.timelineSlider.value = newTimestamp;
        }
        
        updateTimelineStep(); // Update step based on new product
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

    const halfWidth = Math.round(nx / 2);
    const remapped = new Float32Array(values.length);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const oldIndex = j * nx + i;
            let newI = (i < halfWidth) ? i + halfWidth : i - halfWidth;
            remapped[j * nx + newI] = values[oldIndex];
        }
    }
    
    // Handle temperature conversion and unit display
    let displayMin, displayMax, displayUnit, displayColorScale, labelIncrement = null;

    if (appState.selectedProduct === 'temp_2m') {
        const kToF = (k) => (k - 273.15) * 9/5 + 32;
        
        // Use a fixed, clamped range for temperature in Fahrenheit
        displayMin = -20;
        displayMax = 110;
        displayUnit = '°F';
        labelIncrement = 10;

        // Create a wrapper scale that clamps the input F value, then converts it back to K for color lookup
        displayColorScale = (f) => {
            const clampedF = Math.max(displayMin, Math.min(f, displayMax));
            const kelvin = (clampedF - 32) * 5/9 + 273.15;
            return colorScale(kelvin);
        };

        for (let i = 0; i < remapped.length; i++) {
            const fahrenheit = kToF(remapped[i]);
            const color = displayColorScale(fahrenheit);
            const pixelIndex = i * 4;
            
            if (color) {
                imageData.data[pixelIndex] = color[0];
                imageData.data[pixelIndex + 1] = color[1];
                imageData.data[pixelIndex + 2] = color[2];
                imageData.data[pixelIndex + 3] = 200;
            } else {
                imageData.data[pixelIndex + 3] = 0;
            }
        }

    } else if (appState.selectedProduct === 'precip_total') {
        // Use a fixed, clamped range for precipitation in mm
        displayMin = 0;
        displayMax = 50;
        displayUnit = 'mm';
        labelIncrement = 5;

        // Create a wrapper scale that clamps the input precip value for color lookup
        displayColorScale = (p) => {
            const clampedP = Math.max(displayMin, Math.min(p, displayMax));
            return colorScale(clampedP);
        };
        
        for (let i = 0; i < remapped.length; i++) {
            const value = remapped[i];
            const color = displayColorScale(value);
            const pixelIndex = i * 4;
            
            if (color) {
                imageData.data[pixelIndex] = color[0];
                imageData.data[pixelIndex + 1] = color[1];
                imageData.data[pixelIndex + 2] = color[2];
                imageData.data[pixelIndex + 3] = 200;
            } else {
                imageData.data[pixelIndex + 3] = 0;
            }
        }

    } else {
        // Default behavior for other products
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < remapped.length; i++) {
            const value = remapped[i];
            if (value < min) min = value;
            if (value > max) max = value;
    
            const color = colorScale(value);
            const pixelIndex = i * 4;
            
            if (color) {
                imageData.data[pixelIndex] = color[0];
                imageData.data[pixelIndex + 1] = color[1];
                imageData.data[pixelIndex + 2] = color[2];
                imageData.data[pixelIndex + 3] = 200;
            } else {
                imageData.data[pixelIndex + 3] = 0;
            }
        }
        displayMin = min;
        displayMax = max;
        displayUnit = productConfig.unit;
        displayColorScale = colorScale;
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    updateColorBar(appState.map, displayColorScale, displayMin, displayMax, productConfig.name, displayUnit, labelIncrement);

    const bounds = [[-90, -180], [90, 180]];
    const imageUrl = canvas.toDataURL();

    if (appState.dataOverlay) {
        appState.map.removeLayer(appState.dataOverlay);
    }
    
    appState.dataOverlay = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.7,
        interactive: false
    }).addTo(appState.map);

    // After rendering the main overlay, update or clear the city markers
    if (appState.selectedProduct === 'temp_2m') {
        updateCityMarkers(appState.map, appState);
    } else {
        clearCityMarkers();
    }
}


// --- APPLICATION ENTRY POINT ---
window.addEventListener('wasmReady', initializeApp);
