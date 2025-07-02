// /work/viewer/cities.js

// --- APPLICATION STATE (scoped to this module) ---
const cityState = {
    allCities: [],
};

// --- CORE FUNCTIONS ---

/**
 * Fetches the city data from the JSON file.
 * @returns {Promise<Array>} A promise that resolves with the array of city data.
 */
export async function loadCityData() {
    if (cityState.allCities.length > 0) {
        return cityState.allCities;
    }
    try {
        const response = await fetch('./cities.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        cityState.allCities = await response.json();
        console.log(`Loaded ${cityState.allCities.length} cities.`);
        return cityState.allCities;
    } catch (e) {
        console.error("Failed to load or parse cities.json:", e);
        cityState.allCities = []; // Prevent future failed attempts
        return [];
    }
}

/**
 * Draws city markers directly onto the main canvas.
 * @param {CanvasRenderingContext2D} ctx - The 2D context of the canvas to draw on.
 * @param {object} appState - The main application state object.
 * @param {Function} projection - The function to convert [lon, lat] to [x, y] pixel coords.
 */
export function drawCityMarkers(ctx, appState, projection) {
    if (!appState.lastDecodedData) {
        console.log("Skipping city marker drawing: No decoded data available.");
        return;
    }

    // A simple zoom-like filter based on population
    const populationThreshold = 2000000;

    const citiesToShow = cityState.allCities.filter(city => {
        return city.population > populationThreshold;
    });

    citiesToShow.forEach(city => {
        const tempK = getTemperatureAtLocation(city.lat, city.lng, appState.lastDecodedData);
        if (tempK === null) return;

        const tempF = Math.round((tempK - 273.15) * 9/5 + 32);
        const label = `${city.city} ${tempF}°`;

        // Project city coordinates to pixel space
        const [x, y] = projection([city.lng, city.lat]);

        // Check if the projected point is within the canvas bounds
        if (x > 0 && x < ctx.canvas.width && y > 0 && y < ctx.canvas.height) {
            // Style for the text
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            
            // Add a simple shadow/outline for better readability
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.strokeText(label, x + 10, y);
            ctx.fillText(label, x + 10, y);

            // Draw a dot for the city location
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'black';
            ctx.stroke();
        }
    });
}

// --- HELPER FUNCTIONS ---

/**
 * Finds the temperature from the GRIB data grid for a specific lat/lon point.
 * @param {number} lat - The latitude of the location.
 * @param {number} lon - The longitude of the location.
 * @param {{metadata: object, values: Float32Array}} decodedData - The decoded GRIB data.
 * @returns {number|null} The temperature in Kelvin, or null if out of bounds.
 */
function getTemperatureAtLocation(lat, lon, decodedData) {
    // This function remains the same as it operates on GRIB grid indices, not map coordinates.
    const { metadata, values } = decodedData;
    const { nx, ny, lat_first, lon_first, lat_last, lon_last } = metadata.grid;

    // This logic is for lat/lon grids and may need adjustment for HRRR if metadata was complete.
    // For now, we assume it's close enough for this demonstration.
    const normalizedLon = (lon < 0) ? lon + 360 : lon;

    const lonStep = (lon_last - lon_first) / (nx - 1);
    const latStep = (lat_first - lat_last) / (ny - 1); 

    const i = Math.round((normalizedLon - lon_first) / lonStep);
    const j = Math.round((lat_first - lat) / latStep);

    if (i < 0 || i >= nx || j < 0 || j >= ny) {
        return null;
    }

    const index = j * nx + i;
    return values[index] || null;
}
