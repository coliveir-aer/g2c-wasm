// work/jsgrib/main.js
import { renderMessagesTable } from './ui.js';
import { loadTables } from './grib2-lookup.js';

console.log('MAIN: Script loaded.');

const dropZone = document.getElementById('drop-zone');
const resultsContainer = document.getElementById('results-container');
const fileInfoElement = document.getElementById('file-info');

// --- GRIB Processing Logic ---

function findGribMessages(arrayBuffer) {
    console.log('MAIN: findGribMessages: Starting search...');
    const dataView = new DataView(arrayBuffer);
    const messages = [];
    let offset = 0;
    while (offset < arrayBuffer.byteLength - 4) {
        const grib_magic = dataView.getUint32(offset, false);
        if (grib_magic === 0x47524942) { // "GRIB" in ASCII
            if (offset + 16 > arrayBuffer.byteLength) break;
            const messageLength = Number(dataView.getBigUint64(offset + 8, false));
            messages.push({ offset, length: messageLength });
            offset += messageLength;
        } else {
            offset++;
        }
    }
    console.log(`MAIN: findGribMessages: Found a total of ${messages.length} messages.`);
    return messages;
}

function processGribData(fileBuffer) {
    const messages = findGribMessages(fileBuffer);
    const results = [];
    let msgNum = 1;

    try {
        console.log('MAIN: Starting to loop through found messages. State of Module object:');
        console.log(Module);

        for (const message of messages) {
            const messageBuffer = new Uint8Array(fileBuffer, message.offset, message.length);
            
            console.log(`MAIN: Allocating ${message.length} bytes in WASM heap...`);
            const dataPtr = Module._malloc(message.length);
            if (dataPtr === 0) throw new Error("WASM failed to allocate memory.");
            
            console.log(`MAIN: Copying data to pointer ${dataPtr}. HEAPU8 available:`, !!Module.HEAPU8);
            Module.HEAPU8.set(messageBuffer, dataPtr);

            const resultPtr = Module.ccall(
                'process_grib_field', 'number',
                ['number', 'number', 'number'],
                [dataPtr, message.length, 1]
            );

            if (resultPtr !== 0) {
                const metadataPtr = Module.getValue(resultPtr, '*');
                const metadataLen = Module.getValue(resultPtr + 4, 'i32');
                const dataArrayPtr = Module.getValue(resultPtr + 8, '*');
                const numPoints = Module.getValue(resultPtr + 16, 'i32');

                const metadataJson = Module.UTF8ToString(metadataPtr, metadataLen);
                const metadata = JSON.parse(metadataJson);
                metadata.messageNumber = msgNum++;
                
                // Read the raw data from the heap and attach it to the metadata object
                const data = new Float32Array(Module.HEAPU8.buffer, dataArrayPtr, numPoints);
                metadata.data = Array.from(data); // Convert to a standard JS array

                results.push(metadata);
                
                Module.ccall('free_result_memory', null, ['number'], [resultPtr]);
            } else {
                 console.warn(`MAIN: Failed to process GRIB message at offset ${message.offset}.`);
            }
            Module._free(dataPtr);
        }
        renderMessagesTable(results, resultsContainer);
    } catch (error) {
        console.error("Error in GRIB processing:", error);
        resultsContainer.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
    }
}

function handleFileDrop(e) {
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    fileInfoElement.textContent = `Processing: ${file.name}`;
    resultsContainer.innerHTML = '<p>Reading file...</p>';

    const reader = new FileReader();
    reader.onload = (event) => {
        processGribData(event.target.result);
        fileInfoElement.textContent = `Results for: ${file.name}`;
    };
    reader.onerror = (error) => {
        fileInfoElement.textContent = `Failed to read file: ${file.name}`;
        console.error("File reading error:", error);
    };
    reader.readAsArrayBuffer(file);
}

// --- Application Setup ---
// This function sets up the application's event listeners.
function initializeApp() {
    console.log('MAIN: "wasmReady" event received. Initializing UI.');
    dropZone.querySelector('p').textContent = 'Drop GRIB file here';
    
    loadTables(); // Pre-load the GRIB lookup tables

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    dropZone.addEventListener('dragover', () => dropZone.classList.add('drag-over'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', handleFileDrop);
}

// Listen for the custom event from index.html to ensure the WASM module is fully ready.
window.addEventListener('wasmReady', initializeApp);