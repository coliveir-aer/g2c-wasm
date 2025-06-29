/**
 * @file /work/jsgrib/grib2-renderer.js
 * This module is responsible for rendering decoded GRIB2 data onto a canvas
 * and displaying it as an overlay on a Leaflet map.
 */

/**
 * Calculates a color based on a value's position between a min and max.
 * @param {number} value The data point's value.
 * @param {number} min The minimum value in the dataset.
 * @param {number} max The maximum value in the dataset.
 * @returns {Array<number>} An [R, G, B] color array.
 */
function getDynamicColor(value, min, max) {
    // Avoid division by zero if all values are the same
    if (max === min) {
        return [0, 255, 0]; // Default to green if range is zero
    }
    
    // Normalize the value to a 0-1 range
    const ratio = (value - min) / (max - min);

    // Simple blue -> green -> red color interpolation
    const r = Math.round(255 * Math.min(ratio * 2, 1));
    const g = Math.round(255 * (1 - Math.abs(ratio - 0.5) * 2));
    const b = Math.round(255 * Math.max(1 - ratio * 2, 0));

    return [r, g, b];
}

/**
 * Renders the decoded weather data onto a canvas and overlays it on the map.
 * @param {L.Map} mapInstance - The Leaflet map instance.
 * @param {L.ImageOverlay} existingOverlay - The existing overlay layer to be removed.
 * @param {{metadata: object, values: Float32Array}} decodedData - The data from the WASM module.
 * @returns {L.ImageOverlay} The new overlay layer that was added to the map.
 */
export function renderDataOnMap(mapInstance, existingOverlay, decodedData) {
    const { metadata, values } = decodedData;
    const { nx, ny } = metadata.grid;

    // Remove the old overlay if it exists
    if (existingOverlay) {
        mapInstance.removeLayer(existingOverlay);
    }

    if (!nx || !ny) {
        console.error("Invalid grid dimensions for rendering:", metadata.grid);
        return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(nx, ny);

    // --- Dynamic Color Scale Logic ---
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    console.log(`Dynamic color scale range: min=${min}, max=${max}`);

    // The GFS data has longitude from 0 to 359. We remap this to -180 to 180
    const halfWidth = Math.round(nx / 2);
    const remapped = new Float32Array(values.length);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const oldIndex = j * nx + i;
            let newI = (i < halfWidth) ? i + halfWidth : i - halfWidth;
            remapped[j * nx + newI] = values[oldIndex];
        }
    }

    // Draw the remapped data to the canvas using the dynamic color scale
    for (let i = 0; i < remapped.length; i++) {
        const color = getDynamicColor(remapped[i], min, max);
        const pixelIndex = i * 4;
        imageData.data[pixelIndex] = color[0];     // R
        imageData.data[pixelIndex + 1] = color[1]; // G
        imageData.data[pixelIndex + 2] = color[2]; // B
        imageData.data[pixelIndex + 3] = 180;      // Alpha
    }
    ctx.putImageData(imageData, 0, 0);

    // The data is now correctly ordered for a standard global map.
    const bounds = [[-90, -180], [90, 180]];
    const imageUrl = canvas.toDataURL();

    const newOverlay = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.7,
        interactive: false
    }).addTo(mapInstance);

    return newOverlay;
}
