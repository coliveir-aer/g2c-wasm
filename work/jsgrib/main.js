import { renderMessagesTable } from './ui.js';
import { loadTables, getProduct } from './grib2-lookup.js';
import { renderDataOnMap } from './grib2-renderer.js';

// --- DOM ELEMENT REFERENCES ---
const dom = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    resultsArea: document.getElementById('results-area'),
    resultsContainer: document.getElementById('results-container'),
    fileInfoElement: document.getElementById('file-info'),
    // Modal elements
    mapModal: document.getElementById('map-modal'),
    modalTitle: document.getElementById('modal-title'),
    mapContainer: document.getElementById('map-container'),
    closeButton: document.querySelector('.close-button'),
};

let mapInstance = null;
let dataOverlay = null;

// --- GRIB PROCESSING LOGIC ---

/**
 * Finds all GRIB messages in an ArrayBuffer by searching for the "GRIB" magic number.
 * @param {ArrayBuffer} arrayBuffer The raw file buffer.
 * @returns {Array<{offset: number, length: number}>} An array of message offsets and lengths.
 */
function findGribMessages(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);
    const messages = [];
    let offset = 0;
    while (offset < arrayBuffer.byteLength - 4) {
        // "GRIB" in ASCII is 0x47524942
        if (dataView.getUint32(offset, false) === 0x47524942) {
            if (offset + 16 > arrayBuffer.byteLength) break; // Ensure there's enough space for the header
            const messageLength = Number(dataView.getBigUint64(offset + 8, false));
            messages.push({ offset, length: messageLength });
            offset += messageLength;
        } else {
            offset++;
        }
    }
    console.log(`Found a total of ${messages.length} GRIB messages.`);
    return messages;
}

/**
 * Processes a single GRIB message buffer with the WASM module.
 * @param {Uint8Array} gribMessageBuffer The buffer for a single GRIB message.
 * @returns {object|null} The decoded data including metadata and values, or null on failure.
 */
function processGribMessage(gribMessageBuffer) {
    const dataPtr = Module._malloc(gribMessageBuffer.byteLength);
    if (dataPtr === 0) {
        console.error("WASM _malloc failed to allocate memory.");
        return null;
    }
    try {
        Module.HEAPU8.set(gribMessageBuffer, dataPtr);
        const resultPtr = Module.ccall('process_grib_field', 'number', ['number', 'number', 'number'], [dataPtr, gribMessageBuffer.byteLength, 1]);

        if (resultPtr === 0) {
            console.error("C function 'process_grib_field' returned a NULL pointer.");
            return null;
        }

        // Read the GribFieldData struct from WASM memory
        const metadataJsonPtr = Module.getValue(resultPtr, '*');
        const metadataLen = Module.getValue(resultPtr + 4, 'i32');
        const dataArrayPtr = Module.getValue(resultPtr + 8, '*');
        const numPoints = Module.getValue(resultPtr + 16, 'i32');

        const metadata = JSON.parse(Module.UTF8ToString(metadataJsonPtr, metadataLen));
        // Create a copy of the data, as the WASM heap will be freed.
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

/**
 * Orchestrates the processing of a dropped file.
 * @param {ArrayBuffer} fileBuffer The content of the dropped GRIB file.
 */
function processGribFile(fileBuffer) {
    const messages = findGribMessages(fileBuffer);
    const results = [];
    
    for (const message of messages) {
        const messageBuffer = new Uint8Array(fileBuffer, message.offset, message.length);
        const decodedData = processGribMessage(messageBuffer);
        if (decodedData) {
            decodedData.messageNumber = results.length + 1;
            results.push(decodedData);
        } else {
            console.warn(`Failed to process GRIB message at offset ${message.offset}.`);
        }
    }
    
    dom.resultsArea.classList.remove('hidden');
    renderMessagesTable(results, dom.resultsContainer);

    // Add event listeners for the "View" buttons after the table is rendered
    document.querySelectorAll('.view-btn').forEach(button => {
        button.addEventListener('click', () => {
            const messageIndex = parseInt(button.dataset.index, 10);
            showMapModal(results[messageIndex]);
        });
    });
}


// --- UI & EVENT HANDLING ---

/**
 * Handles the file drop or selection event.
 * @param {File} file The file selected by the user.
 */
function handleFile(file) {
    if (!file) return;

    dom.fileInfoElement.textContent = `Processing: ${file.name}`;
    dom.resultsContainer.innerHTML = '<p class="text-center text-gray-500">Reading and processing file...</p>';
    dom.resultsArea.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = (event) => processGribFile(event.target.result);
    reader.onerror = (error) => {
        dom.fileInfoElement.textContent = `Error reading file: ${file.name}`;
        console.error("File reading error:", error);
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Sets up and displays the modal with a Leaflet map and data overlay.
 * @param {object} decodedData The full decoded data object for a message.
 */
function showMapModal(decodedData) {
    const { metadata } = decodedData;
    const product = getProduct(metadata.info.discipline, metadata.sections.product_definition.data[0], metadata.sections.product_definition.data[1]);
    dom.modalTitle.textContent = `${product.name} (${product.shortName})`;
    
    dom.mapModal.style.display = 'block';

    // Initialize map only once, or reset its view if it already exists
    if (!mapInstance) {
        mapInstance = L.map(dom.mapContainer, {
            crs: L.CRS.EPSG4326,
            worldCopyJump: true
        }).setView([0, 0], 1);
        L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', {
            layers: 'OSM_Land_Water_Map',
            format: 'image/jpeg',
            transparent: true,
            attribution: 'NASA GIBS'
        }).addTo(mapInstance);
    } else {
        mapInstance.invalidateSize(); // Important for re-rendering map in a modal
    }

    // Use the new modular rendering function and store the returned overlay
    dataOverlay = renderDataOnMap(mapInstance, dataOverlay, decodedData);
}


/**
 * Sets up the application's event listeners.
 */
function initializeApp() {
    console.log('WASM runtime ready. Initializing UI.');
    dom.dropZone.querySelector('p').textContent = 'Drag & Drop a GRIB2 file here';
    
    loadTables(); // Pre-load the GRIB lookup tables

    // Drag and drop event listeners
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dom.dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    dom.dropZone.addEventListener('dragenter', () => dom.dropZone.classList.add('drag-over'));
    dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('drag-over'));
    dom.dropZone.addEventListener('drop', e => {
        dom.dropZone.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    });
    
    // Click to select file listener
    dom.dropZone.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
    
    // Modal close listeners
    dom.closeButton.onclick = () => dom.mapModal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == dom.mapModal) {
            dom.mapModal.style.display = 'none';
        }
    };
}

// Listen for the custom event from index.html to ensure the WASM module is fully ready.
window.addEventListener('wasmReady', initializeApp);
