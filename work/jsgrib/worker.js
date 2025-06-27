// work/jsgrib/worker.js
console.log('WORKER: Script loaded. Using classic importScripts pattern.');

// This is the global configuration object that the Emscripten glue code will look for.
var Module = {
    // DIAGNOSTIC: Log what file the runtime is looking for.
    locateFile: function(path, prefix) {
        console.log(`WORKER: locateFile triggered. path: "${path}", prefix: "${prefix}"`);
        // The .wasm file is in the same directory as this worker script.
        return path.endsWith('.wasm') ? 'g2clib.wasm' : path;
    },

    // onRuntimeInitialized is called when the JS part of the runtime is ready.
    onRuntimeInitialized: function() {
        console.log('WORKER: onRuntimeInitialized callback fired. Module state:');
        // DIAGNOSTIC: Log the entire Module object to inspect its properties.
        console.log(Module);
        
        // ALL message handling logic should be defined and assigned HERE.
        self.onmessage = handleMessage;
        
        self.postMessage({ type: 'READY' });
        console.log('WORKER: "READY" message posted to main thread.');

        /**
         * The main processing function. This is called only when the WASM module is ready.
         */
        function handleMessage(e) {
            console.log('WORKER: handleMessage: Received message from main thread:', e.data);
            const { fileBuffer } = e.data;
            const messages = findGribMessages(fileBuffer);
            const results = [];
            let msgNum = 1;
            try {
                console.log('WORKER: handleMessage: Starting to loop through found messages...');
                for (const message of messages) {
                    console.log(`WORKER: handleMessage: Processing message #${msgNum} (offset: ${message.offset}, length: ${message.length})`);
                    const messageBuffer = new Uint8Array(fileBuffer, message.offset, message.length);

                    console.log('WORKER: handleMessage: Calling _malloc...');
                    const dataPtr = Module._malloc(message.length);
                    if (dataPtr === 0) throw new Error("Failed to allocate memory in WASM heap.");
                    console.log(`WORKER: handleMessage: _malloc successful. Pointer: ${dataPtr}`);
                    
                    // DIAGNOSTIC: Log the Module object right before the failing line.
                    console.log('WORKER: handleMessage: State of Module object right before HEAPU8.set:');
                    console.log(Module);
                    
                    Module.HEAPU8.set(messageBuffer, dataPtr);
                    console.log('WORKER: handleMessage: Copied message buffer to WASM heap.');

                    console.log('WORKER: handleMessage: Calling C function "process_grib_field"...');
                    const resultPtr = Module.ccall(
                        'process_grib_field',
                        'number',
                        ['number', 'number', 'number'],
                        [dataPtr, message.length, 1]
                    );
                    console.log(`WORKER: handleMessage: C function returned pointer: ${resultPtr}`);

                    if (resultPtr === 0) {
                        console.warn(`Worker: Failed to process GRIB message at offset ${message.offset}. Freeing input buffer and continuing.`);
                        Module._free(dataPtr);
                        continue;
                    }

                    console.log('WORKER: handleMessage: Reading result struct from memory...');
                    const metadataPtr = Module.getValue(resultPtr, '*');
                    const metadataLen = Module.getValue(resultPtr + 4, 'i32');
                    console.log(`WORKER: handleMessage: Metadata Ptr: ${metadataPtr}, Metadata Len: ${metadataLen}`);
                    
                    const metadataJson = Module.UTF8ToString(metadataPtr, metadataLen);
                    const metadata = JSON.parse(metadataJson);
                    console.log('WORKER: handleMessage: Parsed metadata:', metadata);

                    metadata.messageNumber = msgNum++;
                    results.push(metadata);

                    console.log(`WORKER: handleMessage: Freeing result memory at pointer: ${resultPtr}`);
                    Module._free_result_memory(resultPtr);

                    console.log(`WORKER: handleMessage: Freeing input data memory at pointer: ${dataPtr}`);
                    Module._free(dataPtr);
                }

                console.log('WORKER: handleMessage: Processing complete. Posting SUCCESS back to main thread.');
                self.postMessage({ type: 'SUCCESS', payload: results });

            } catch (error) {
                console.error("Error in GRIB processing worker:", error);
                self.postMessage({ type: 'ERROR', payload: error.message });
            }
        }
    }
};

console.log('WORKER: Calling importScripts("g2clib.js")...');
importScripts('g2clib.js');

/**
 * Finds all GRIB messages in a buffer by locating the 'GRIB' magic number
 * and reading the total message length from Section 0.
 */
function findGribMessages(arrayBuffer) {
    console.log('WORKER: findGribMessages: Starting search...');
    const dataView = new DataView(arrayBuffer);
    const messages = [];
    let offset = 0;
    while (offset < arrayBuffer.byteLength - 4) {
        const grib_magic = dataView.getUint32(offset, false);
        if (grib_magic === 0x47524942) { // "GRIB" in ASCII
            if (offset + 16 > arrayBuffer.byteLength) {
                console.log(`WORKER: findGribMessages: Found 'GRIB' at offset ${offset} but not enough data for header.`);
                break;
            }
            const messageLength = Number(dataView.getBigUint64(offset + 8, false));
            console.log(`WORKER: findGribMessages: Found GRIB message at offset ${offset} with length ${messageLength}.`);
            messages.push({ offset, length: messageLength });
            offset += messageLength;
        } else {
            offset++;
        }
    }
    console.log(`WORKER: findGribMessages: Found a total of ${messages.length} messages.`);
    return messages;
}