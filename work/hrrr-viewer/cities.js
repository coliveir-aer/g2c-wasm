// /work/viewer/cities.js

// --- APPLICATION STATE (scoped to this module) ---
const cityState = {
    allCities: [],
    cityMarkersLayer: null,
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
 * Updates the city markers based on the current map view and data.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {object} appState - The main application state object.
 */
export function updateCityMarkers(map, appState) {
    if (!appState.lastDecodedData) {
        console.log("Skipping city marker update: No decoded data available.");
        return;
    }

    // Initialize the marker layer group if it doesn't exist
    if (!cityState.cityMarkersLayer) {
        // Add to the custom 'cityLabels' pane to ensure it's on top.
        cityState.cityMarkersLayer = L.layerGroup([], { pane: 'cityLabels' }).addTo(map);
    }
    cityState.cityMarkersLayer.clearLayers();

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const populationThreshold = getPopulationThresholdForZoom(zoom);

    const citiesToShow = cityState.allCities.filter(city => {
        return city.population > populationThreshold && bounds.contains([city.lat, city.lng]);
    });

    console.log(`Zoom: ${zoom}, Population > ${populationThreshold}, Found ${citiesToShow.length} cities in view.`);

    citiesToShow.forEach(city => {
        const tempK = getTemperatureAtLocation(city.lat, city.lng, appState.lastDecodedData);
        if (tempK === null) return;

        const tempF = Math.round((tempK - 273.15) * 9/5 + 32);

        const marker = L.marker([city.lat, city.lng], {
            icon: L.divIcon({
                className: 'city-marker-container',
                html: `<div class="city-dot"></div><div class="city-label">${city.city} ${tempF}°</div>`,
                iconAnchor: [4, 4], // Anchor to the center of the 8px dot
                iconSize: null // Let CSS control the size
            })
        });
        cityState.cityMarkersLayer.addLayer(marker);
    });
}

/**
 * Removes all city markers from the map.
 */
export function clearCityMarkers() {
    if (cityState.cityMarkersLayer) {
        cityState.cityMarkersLayer.clearLayers();
    }
}

// --- HELPER FUNCTIONS ---

/**
 * Determines the minimum population a city needs to be shown at a given zoom level.
 * @param {number} zoom - The current map zoom level.
 * @returns {number} The minimum population threshold.
 */
function getPopulationThresholdForZoom(zoom) {
    if (zoom < 4) return 7000000;
    if (zoom < 5) return 2000000;
    if (zoom < 6) return 1000000;
    if (zoom < 7) return 500000;
    return 250000; // Show more cities when zoomed in further
}

/**
 * Finds the temperature from the GRIB data grid for a specific lat/lon point.
 * @param {number} lat - The latitude of the location.
 * @param {number} lon - The longitude of the location.
 * @param {{metadata: object, values: Float32Array}} decodedData - The decoded GRIB data.
 * @returns {number|null} The temperature in Kelvin, or null if out of bounds.
 */
function getTemperatureAtLocation(lat, lon, decodedData) {
    const { metadata, values } = decodedData;
    const { nx, ny, lat_first, lon_first, lat_last, lon_last } = metadata.grid;

    // The GFS grid longitude goes from 0 to 359.x. Normalize the city's longitude.
    const normalizedLon = (lon < lon_first) ? lon + 360 : lon;

    // Calculate grid resolution
    const lonStep = (lon_last - lon_first) / (nx - 1);
    const latStep = (lat_first - lat_last) / (ny - 1); // lat decreases, so this is positive

    // Find the nearest grid indices by direct calculation.
    const i = Math.round((normalizedLon - lon_first) / lonStep);
    const j = Math.round((lat_first - lat) / latStep);

    // Check if the calculated indices are within the grid bounds
    if (i < 0 || i >= nx || j < 0 || j >= ny) {
        return null;
    }

    // The raw data is not remapped, so we can use the direct index.
    const index = j * nx + i;

    return values[index] || null;
}
