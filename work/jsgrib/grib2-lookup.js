let grib2Tables = null;

/**
 * Loads the GRIB2 parameter definition tables from a JSON file.
 */
export async function loadTables() {
    // Don't load more than once.
    if (grib2Tables) return; 
    
    try {
        const response = await fetch('./grib2-tables.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        grib2Tables = await response.json();
        console.log("GRIB2 tables loaded successfully.");
    } catch (e) {
        console.error("Failed to load or parse grib2-tables.json:", e);
        grib2Tables = {}; // Prevent future failed attempts
    }
}

/**
 * Looks up the human-readable name and unit for a GRIB2 parameter.
 * @param {number} discipline - GRIB message discipline code.
 * @param {number} category - Parameter category code.
 * @param {number} number - Parameter number code.
 * @returns {{shortName: string, name: string, unit: string}}
 */
export function getProduct(discipline, category, number) {
    try {
        // Navigate through the nested JSON structure to find the parameter details.
        const d = grib2Tables[discipline];
        const c = d.categories[category];
        const p = c.parameters[number];
        return {
            shortName: p.shortName || 'N/A',
            name: p.name || 'Unknown',
            unit: p.unit || ''
        };
    } catch (e) {
        // Return a default object if any part of the lookup fails.
        return {
            shortName: 'N/A',
            name: 'Unknown Parameter',
            unit: ''
        };
    }
}
