let grib2Tables = null;

export async function loadTables() {
    if (grib2Tables) return; // Don't load more than once
    
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

export function getProduct(discipline, category, number) {
    try {
        const d = grib2Tables[discipline];
        const c = d.categories[category];
        const p = c.parameters[number];
        return {
            shortName: p.shortName || 'N/A',
            name: p.name || 'Unknown',
            unit: p.unit || ''
        };
    } catch (e) {
        return {
            shortName: 'N/A',
            name: 'Unknown Parameter',
            unit: ''
        };
    }
}