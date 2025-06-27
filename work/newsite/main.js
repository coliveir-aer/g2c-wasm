// --- CONSTANTS ---
const S3_BUCKET_URL_BASE = 'https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com/';
const GFS_PRODUCT_TYPE = 'pgrb2.1p00'; // 1.00 degree data

// --- GRIB2 LOOKUP TABLES & DEFS ---
const grib2Tables = {
  "0": { // Meteorological
    "0": { "name": "Temperature", "params": { "0": { "short": "TMP", "unit": "K", "levels": ["sfc", "2m", "1000", "925", "850", "700", "500", "250", "100"], "idxMatch": {"sfc": "surface", "2m": "2 m above ground", "1000": "1000 mb", "925": "925 mb", "850": "850 mb", "700": "700 mb", "500": "500 mb", "250": "250 mb", "100": "100 mb"} }}},
    "1": { "name": "Moisture", "params": { "1": { "short": "RH", "unit": "%", "levels": ["sfc", "2m", "850", "700", "500"], "idxMatch": {"sfc": "surface", "2m": "2 m above ground", "850": "850 mb", "700": "700 mb", "500": "500 mb"} }, "8": {"short": "APCP", "name": "Total Precipitation", "unit": "kg m-2", "levels": ["sfc"], "idxMatch": {"sfc": "surface"} }}},
    "2": { "name": "Momentum", "params": { "1": { "short": "WIND", "unit": "m s-1", "levels": ["10m", "80m", "850", "700", "500", "250"], "idxMatch": {"10m": "10 m above ground", "80m": "80 m above ground", "850": "850 mb", "700": "700 mb", "500": "500 mb", "250": "250 mb"} }}},
    "3": { "name": "Mass", "params": { "5": { "short": "HGT", "unit": "gpm", "levels": ["sfc", "1000", "925", "850", "700", "500", "250"], "idxMatch": {"sfc": "surface", "1000": "1000 mb", "925": "925 mb", "850": "850 mb", "700": "700 mb", "500": "500 mb", "250": "250 mb"} }}},
    "7": { "name": "Stability", "params": { "6": { "short": "CAPE", "unit": "J kg-1", "levels": ["sfc"], "idxMatch": {"sfc": "surface"} }}}
  }
};
const levelMapping = {
    "sfc": { type: 1, value: 0 }, "2m": { type: 103, value: 2 }, "10m": { type: 103, value: 10 },
    "80m": { type: 103, value: 80}, "1000": {type: 100, value: 100000}, "925": {type: 100, value: 92500},
    "850": {type: 100, value: 85000}, "700": {type: 100, value: 70000}, "500": {type: 100, value: 50000},
    "250": {type: 100, value: 25000}, "100": {type: 100, value: 100000}
};

// --- DOM ELEMENT REFERENCES ---
const elements = {
    productSelector: document.getElementById('product-selector'),
    levelSelector: document.querySelector('#level-selector div'),
    timelineSlider: document.getElementById('timeline-slider'),
    forecastHourDisplay: document.getElementById('forecast-hour-display'),
    gfsRunDisplay: document.getElementById('gfs-run-display'),
    gfsRunButton: document.getElementById('gfs-run-button'),
    loadDataButton: document.getElementById('load-data-button'),
    mapPlaceholder: document.getElementById('map-placeholder'),
    plotModal: document.getElementById('plot-modal'),
    plotTitle: document.getElementById('plot-title'),
    plotContainer: document.getElementById('plot-container'),
    closePlotModalButton: document.getElementById('close-plot-modal-button'),
    runSelectModal: document.getElementById('run-select-modal'),
    dateSelector: document.getElementById('date-selector'),
    cycleSelector: document.getElementById('cycle-selector'),
    closeRunModalButton: document.getElementById('close-run-modal-button'),
    updateRunButton: document.getElementById('update-run-button')
};

// --- APPLICATION STATE ---
const appState = {
    gfsDate: new Date(), gfsCycle: 12, forecastHour: 0,
    selectedProductKey: '0-0', selectedLevelKey: '2m'
};

// --- GRIB PROCESSING LOGIC ---
function findMessageInIndex(indexText, productInfo, levelKey) {
    console.log(`LOG: findMessageInIndex: START`);
    console.log(`LOG: findMessageInIndex: Searching for product:`, productInfo);
    console.log(`LOG: findMessageInIndex: Searching for level key:`, levelKey);

    const levelString = productInfo.idxMatch[levelKey];
    if (!levelString) {
        console.error(`LOG: findMessageInIndex: ERROR - No index file match string defined for level key: ${levelKey}`);
        return null;
    }
    console.log(`LOG: findMessageInIndex: Using level match string: "${levelString}"`);

    const lines = indexText.split('\n').filter(line => line.trim() !== '');
    console.log(`LOG: findMessageInIndex: Parsed ${lines.length} lines from index file.`);

    // Step 1: Get all start bytes first. This is the crucial part.
    const startBytes = lines.map(line => {
        const fields = line.split(':');
        return fields.length > 1 ? parseInt(fields[1], 10) : null;
    });
    console.log(`LOG: findMessageInIndex: Created array of ${startBytes.length} start bytes.`);

    // Step 2: Find the index of our target line.
    const targetLineIndex = lines.findIndex(line => {
        const fields = line.split(':');
        return fields.length > 4 && fields[3] === productInfo.short && fields[4].startsWith(levelString);
    });

    if (targetLineIndex === -1) {
        console.warn(`LOG: findMessageInIndex: WARN - Could not find line for ${productInfo.short} at ${levelKey}`);
        return null;
    }
    console.log(`LOG: findMessageInIndex: Found target message at line index: ${targetLineIndex}`);

    // Step 3: Use the pre-calculated startBytes array to determine the range.
    const startByte = startBytes[targetLineIndex];
    let endByte = ''; // Default to open-ended for the last message in the file

    // Find the next valid start byte to determine the end of our message
    for (let i = targetLineIndex + 1; i < startBytes.length; i++) {
        if (startBytes[i] !== null) {
            endByte = startBytes[i] - 1;
            break;
        }
    }
    
    if(startByte === null) {
        console.error("LOG: findMessageInIndex: ERROR - Could not determine start byte for the target line.");
        return null;
    }

    const result = { start: startByte, end: endByte };
    console.log(`LOG: findMessageInIndex: SUCCESS - Calculated byte range:`, result);
    return result;
}

async function processGribData(gribMessageBuffer) {
    console.log(`LOG: processGribData: START`);
    console.log(`LOG: processGribData: Received buffer of size: ${gribMessageBuffer.byteLength}`);

    const dataPtr = Module._malloc(gribMessageBuffer.byteLength);
    console.log(`LOG: processGribData: Allocated ${gribMessageBuffer.byteLength} bytes in WASM heap at pointer: ${dataPtr}`);
    
    Module.HEAPU8.set(new Uint8Array(gribMessageBuffer), dataPtr);
    console.log(`LOG: processGribData: Copied data to WASM heap.`);

    console.log(`LOG: processGribData: Calling C function 'process_grib_field'...`);
    const resultPtr = Module.ccall(
        'process_grib_field', 'number',
        ['number', 'number', 'number'],
        [dataPtr, gribMessageBuffer.byteLength, 1]
    );
    console.log(`LOG: processGribData: C function returned pointer: ${resultPtr}`);

    if (resultPtr !== 0) {
        console.log(`LOG: processGribData: Processing successful result.`);
        const metadataPtr = Module.getValue(resultPtr, '*');
        const metadataLen = Module.getValue(resultPtr + 4, 'i32');
        const dataArrayPtr = Module.getValue(resultPtr + 8, '*');
        const numPoints = Module.getValue(resultPtr + 16, 'i32');
        console.log(`LOG: processGribData: Reading metadata from ptr=${metadataPtr}, len=${metadataLen}`);
        const metadata = JSON.parse(Module.UTF8ToString(metadataPtr, metadataLen));
        console.log(`LOG: processGribData: Parsed metadata:`, metadata);
        
        console.log(`LOG: processGribData: Reading data grid from ptr=${dataArrayPtr}, num_points=${numPoints}`);
        const data = new Float32Array(Module.HEAPU8.buffer, dataArrayPtr, numPoints);
        
        showPlot(metadata, data);
        
        console.log(`LOG: processGribData: Freeing result memory at pointer: ${resultPtr}`);
        Module.ccall('free_result_memory', null, ['number'], [resultPtr]);
    } else {
        console.error('LOG: processGribData: ERROR - C function returned NULL pointer.');
        elements.mapPlaceholder.textContent = 'WASM module failed to decode data.';
    }

    console.log(`LOG: processGribData: Freeing input data memory at pointer: ${dataPtr}`);
    Module._free(dataPtr);
    console.log(`LOG: processGribData: END`);
}

// --- UI & RENDERING ---
function showPlot(metadata, dataGrid) {
    console.log(`LOG: showPlot: START`);
    elements.mapPlaceholder.textContent = 'Data Decoded!';
    const [cat, param] = appState.selectedProductKey.split('-').map(Number);
    const productInfo = getProductInfo(cat, param);
    console.log(`LOG: showPlot: Rendering plot for ${productInfo.name}`);
    
    const zData = [];
    const nx = metadata.grid_nx;
    const ny = metadata.grid_ny;
    if (nx > 0 && ny > 0) {
        for (let i = 0; i < ny; i++) { zData.push(Array.from(dataGrid.slice(i * nx, (i + 1) * nx))); }
        console.log(`LOG: showPlot: Reshaped 1D data of length ${dataGrid.length} to 2D grid of ${ny}x${nx}`);
    } else {
         console.error('LOG: showPlot: ERROR - Grid dimensions not found in metadata.');
         elements.mapPlaceholder.textContent = 'Error: Grid dimensions not found.';
         return;
    }

    const plotData = [{
        z: zData, type: 'heatmap', colorscale: 'Viridis',
        colorbar: { title: productInfo.unit, titleside: 'right' }
    }];
    const layout = {
        title: `${productInfo.name} (${productInfo.short}) at ${appState.selectedLevelKey} | F${appState.forecastHour}`,
        xaxis: { title: 'Longitude Index' },
        yaxis: { title: 'Latitude Index', autorange: 'reversed' }
    };

    console.log(`LOG: showPlot: Calling Plotly.newPlot...`);
    Plotly.newPlot(elements.plotContainer, plotData, layout, {responsive: true});
    elements.plotModal.classList.add('visible');
    console.log(`LOG: showPlot: END`);
}

function updateUI() {
    elements.forecastHourDisplay.textContent = `+${appState.forecastHour}h`;
    if (appState.gfsDate && !isNaN(appState.gfsDate)) {
        const dateStr = appState.gfsDate.toISOString().slice(0, 10);
        const cycleStr = appState.gfsCycle.toString().padStart(2, '0') + 'Z';
        elements.gfsRunDisplay.textContent = `${dateStr} / ${cycleStr}`;
        elements.dateSelector.value = dateStr;
    }
    elements.cycleSelector.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.cycle) === appState.gfsCycle);
    });
}

function getProductInfo(category, parameter) {
    try { return grib2Tables["0"][category].params[parameter]; } 
    catch (e) { return { name: "Unknown", short: "N/A", unit: "", levels: [], idxMatch: {} }; }
}

function populateControls() {
    elements.productSelector.innerHTML = '';
    for (const catKey in grib2Tables["0"]) {
        const category = grib2Tables["0"][catKey];
        for (const paramKey in category.params) {
            const param = category.params[paramKey];
            const option = document.createElement('option');
            option.value = `${catKey}-${paramKey}`;
            option.textContent = `${param.name} (${param.short})`;
            elements.productSelector.appendChild(option);
        }
    }
    elements.productSelector.value = appState.selectedProductKey;
    updateLevelSelector();
}

function updateLevelSelector() {
     const [cat, param] = elements.productSelector.value.split('-').map(Number);
     const productInfo = getProductInfo(cat, param);
     appState.selectedProductKey = `${cat}-${param}`;
     elements.levelSelector.innerHTML = ''; 
     
     productInfo.levels.forEach(levelKey => {
         const button = document.createElement('button');
         button.textContent = levelKey;
         button.dataset.levelKey = levelKey;
         button.className = 'px-3 py-1.5 rounded-lg hover:bg-gray-200 w-full text-center';
         elements.levelSelector.appendChild(button);
     });
     
     const currentLevelButton = elements.levelSelector.querySelector(`[data-level-key="${appState.selectedLevelKey}"]`);
     if (currentLevelButton) {
         currentLevelButton.classList.add('active');
     } else {
        const firstButton = elements.levelSelector.querySelector('button');
        if (firstButton) {
            firstButton.classList.add('active');
            appState.selectedLevelKey = firstButton.dataset.levelKey;
        }
     }
}

async function fetchAndProcessGrib() {
    console.group(`--- fetchAndProcessGrib | F${appState.forecastHour} | ${appState.selectedProductKey} | ${appState.selectedLevelKey} ---`);
    const dateStr = appState.gfsDate.toISOString().slice(0, 10).replace(/-/g, '');
    const cycleStr = appState.gfsCycle.toString().padStart(2, '0');
    const hourStr = appState.forecastHour.toString().padStart(3, '0');
    
    // CORRECTED: The main data file does NOT have a .grib2 suffix.
    const fileName = `gfs.t${cycleStr}z.${GFS_PRODUCT_TYPE}.f${hourStr}`;
    const s3Path = `gfs.${dateStr}/${cycleStr}/atmos/${fileName}`;
    
    const idxUrl = S3_BUCKET_URL_BASE + s3Path + '.idx';
    const gribUrl = S3_BUCKET_URL_BASE + s3Path;

    console.log("LOG: Step 1: Fetching index file. URL:", idxUrl);
    elements.mapPlaceholder.textContent = 'Fetching GRIB index...';
    
    try {
        const idxResponse = await fetch(idxUrl);
        if (!idxResponse.ok) {
            throw new Error(`Could not fetch index file: ${idxResponse.status} ${idxResponse.statusText}`);
        }
        const indexText = await idxResponse.text();
        console.log(`LOG: Step 1: Successfully fetched index file (${indexText.length} chars).`);

        console.log("LOG: Step 2: Finding byte range in index.");
        const [cat, param] = appState.selectedProductKey.split('-').map(Number);
        const productInfo = getProductInfo(cat, param);
        const byteRange = findMessageInIndex(indexText, productInfo, appState.selectedLevelKey);
        if (!byteRange) {
            throw new Error(`Could not find ${productInfo.short} at ${appState.selectedLevelKey} in index file.`);
        }
        
        console.log(`LOG: Step 3: Fetching GRIB data slice. URL: ${gribUrl}`);
        console.log(`LOG: Step 3: Using Range header: bytes=${byteRange.start}-${byteRange.end}`);
        elements.mapPlaceholder.textContent = 'Fetching GRIB message...';
        const gribResponse = await fetch(gribUrl, {
            headers: { 'Range': `bytes=${byteRange.start}-${byteRange.end}` }
        });
        if (!gribResponse.ok) {
            throw new Error(`Byte range fetch failed: ${gribResponse.status} ${gribResponse.statusText}`);
        }
        const gribMessageBuffer = await gribResponse.arrayBuffer();
        console.log(`LOG: Step 3: Successfully fetched GRIB slice (${gribMessageBuffer.byteLength} bytes).`);
        
        console.log("LOG: Step 4: Passing data slice to WASM for decoding.");
        elements.mapPlaceholder.textContent = 'Decoding with WASM...';
        await processGribData(gribMessageBuffer);
        console.log("LOG: Step 4: WASM processing complete.");

    } catch (error) {
        console.error("LOG: ERROR in fetchAndProcessGrib:", error);
        elements.mapPlaceholder.textContent = `Error: ${error.message}`;
    } finally {
        console.groupEnd();
    }
}

function initializeDefaultRun() {
    console.log("LOG: initializeDefaultRun: START");
    const now = new Date();
    console.log(`LOG: initializeDefaultRun: Current UTC time is ${now.toUTCString()}`);
    
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    console.log(`LOG: initializeDefaultRun: Yesterday UTC was ${yesterday.toUTCString()}`);
    
    appState.gfsDate = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()));
    appState.gfsCycle = 12;

    console.log(`LOG: initializeDefaultRun: END - Set default run to ${appState.gfsDate.toISOString().slice(0,10)} / ${appState.gfsCycle}Z`);
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    window.addEventListener('wasmReady', () => {
        console.log("LOG: Event 'wasmReady' received. Initializing App...");
        initializeDefaultRun();
        populateControls();
        updateUI();
        elements.loadDataButton.disabled = false;
        console.log("LOG: App initialization complete.");
    }, { once: true });
    
    elements.loadDataButton.addEventListener('click', fetchAndProcessGrib);
    elements.timelineSlider.addEventListener('input', (e) => { appState.forecastHour = parseInt(e.target.value); updateUI(); });
    elements.productSelector.addEventListener('change', updateLevelSelector);
    elements.levelSelector.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            elements.levelSelector.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            appState.selectedLevelKey = e.target.dataset.levelKey;
        }
    });

    // Modal listeners
    elements.gfsRunButton.addEventListener('click', () => elements.runSelectModal.classList.add('visible'));
    elements.closeRunModalButton.addEventListener('click', () => elements.runSelectModal.classList.remove('visible'));
    elements.updateRunButton.addEventListener('click', () => {
        if (elements.dateSelector.value) {
            // Fix for date handling: ensure time is handled as UTC
            const dateParts = elements.dateSelector.value.split('-');
            appState.gfsDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
            elements.runSelectModal.classList.remove('visible');
            updateUI();
        } else {
            console.error("Date selector is empty. Cannot update run.");
        }
    });
    elements.cycleSelector.addEventListener('click', (e) => {
         if (e.target.tagName === 'BUTTON') {
             appState.gfsCycle = parseInt(e.target.dataset.cycle);
             updateUI();
         }
    });
    elements.closePlotModalButton.addEventListener('click', () => {
        Plotly.purge(elements.plotContainer);
        elements.plotModal.classList.remove('visible');
    });
    elements.plotModal.addEventListener('click', (e) => { 
        if (e.target === elements.plotModal) { 
            Plotly.purge(elements.plotContainer);
            elements.plotModal.classList.remove('visible'); 
        } 
    });
}

// --- INITIALIZATION ---
setupEventListeners();
