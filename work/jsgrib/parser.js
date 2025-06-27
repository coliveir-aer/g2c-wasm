// A helper class to read from the ArrayBuffer
class Grib2DataView {
    constructor(arrayBuffer) {
        this.dataView = new DataView(arrayBuffer);
        this.byteOffset = 0;
    }

    getUint8() {
        const val = this.dataView.getUint8(this.byteOffset);
        this.byteOffset += 1;
        return val;
    }

    getUint16() {
        const val = this.dataView.getUint16(this.byteOffset, false); // Big-endian
        this.byteOffset += 2;
        return val;
    }

    getUint32() {
        const val = this.dataView.getUint32(this.byteOffset, false);
        this.byteOffset += 4;
        return val;
    }
    
    getBigUint64() {
        const val = this.dataView.getBigUint64(this.byteOffset, false);
        this.byteOffset += 8;
        return val;
    }

    getString(length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.getUint8());
        }
        return str;
    }

    seek(newOffset) {
        this.byteOffset = newOffset;
    }

    tell() {
        return this.byteOffset;
    }
}

function parseSection0(gribView) {
    const magic = gribView.getString(4);
    if (magic !== 'GRIB') throw new Error('Not a GRIB message.');
    gribView.seek(gribView.tell() + 2);
    const discipline = gribView.getUint8();
    const edition = gribView.getUint8();
    if (edition !== 2) throw new Error(`Unsupported GRIB edition: ${edition}`);
    const totalLength = gribView.getBigUint64();
    return { discipline, edition, totalLength: Number(totalLength) };
}

function parseSection1(gribView) {
    // Correctly skip to the start of the date/time fields (Octet 12)
    gribView.seek(gribView.tell() + 7);
    const year = gribView.getUint16();
    const month = gribView.getUint8();
    const day = gribView.getUint8();
    const hour = gribView.getUint8();
    const minute = gribView.getUint8();
    const second = gribView.getUint8();
    return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)) };
}

function parseSection3(gribView) {
    gribView.seek(gribView.tell() + 1); // Skip source of grid def
    const numberOfDataPoints = gribView.getUint32();
    gribView.seek(gribView.tell() + 1); // Skip optional list of numbers
    gribView.seek(gribView.tell() + 1); // Skip interpretation of list
    const gridDefinitionTemplate = gribView.getUint16();
    // In a full parser, we'd parse the specific template here.
    return { numberOfDataPoints, gridDefinitionTemplate };
}

function parseSection4(gribView) {
    gribView.seek(gribView.tell() + 2); // Skip optional coordinates
    const productDefinitionTemplate = gribView.getUint16();
    const parameterCategory = gribView.getUint8();
    const parameterNumber = gribView.getUint8();
    // In a full parser, we'd parse the rest of the template.
    return { productDefinitionTemplate, parameterCategory, parameterNumber };
}


export function parseGrib(arrayBuffer) {
    const messages = [];
    let offset = 0;

    while (offset < arrayBuffer.byteLength) {
        const gribView = new Grib2DataView(arrayBuffer);
        gribView.seek(offset);
        
        const message = {
            messageNumber: messages.length + 1
        };

        try {
            if (gribView.getString(4) !== 'GRIB') break;
            gribView.seek(offset);

            // --- Section 0 ---
            const section0 = parseSection0(gribView);
            message.totalLength = section0.totalLength;
            message.discipline = section0.discipline;

            // --- Loop through sections 1-7 ---
            while (true) {
                const sectionStartOffset = gribView.tell();
                // Check for end section '7777'
                if (sectionStartOffset + 4 > arrayBuffer.byteLength || gribView.getString(4) === '7777') {
                    break;
                }
                gribView.seek(sectionStartOffset);

                const sectionLength = gribView.getUint32();
                const sectionNumber = gribView.getUint8();
                
                if (sectionNumber === 1) {
                    message.refTime = parseSection1(gribView).date.toISOString();
                } else if (sectionNumber === 3) {
                    message.grid = parseSection3(gribView);
                } else if (sectionNumber === 4) {
                    message.product = parseSection4(gribView);
                }
                
                // Seek to the end of the current section to be ready for the next
                gribView.seek(sectionStartOffset + sectionLength);
            }
            
            messages.push(message);
            offset += section0.totalLength;

        } catch (e) {
            console.error(`Failed to parse GRIB message #${message.messageNumber}:`, e);
            break; 
        }
    }
    return messages;
}