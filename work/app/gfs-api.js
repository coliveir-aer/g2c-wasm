import { logDebug, parseForecastHours } from './utils.js';
import { setUIState, updateResultsTable } from './ui.js';
import { addInventoryButtons } from './inventory.js';
import { S3_BUCKET_NAME, S3_BUCKET_HOSTNAME, FETCH_TIMEOUT } from './config.js';

export async function fetchGfsData(elements) {
    logDebug('Starting GFS data query.');
    setUIState(elements, true);

    const selectedDate = elements.dateSelector.value.replace(/-/g, '');
    const selectedCycle = elements.cycleSelector.value;
    const selectedProduct = elements.productSelector.value;
    const requestedHours = parseForecastHours(elements.forecastHourSelector.value);
    logDebug('User Selections:', { date: selectedDate, cycle: selectedCycle, product: selectedProduct, hours: requestedHours ? Array.from(requestedHours) : 'All' });
    if (!selectedDate) {
        setUIState(elements, false, 'Please select a valid date.');
        return;
    }

    const productIdentifier = `gfs.t${selectedCycle}z.${selectedProduct}`;
    const s3Prefix = `gfs.${selectedDate}/${selectedCycle}/atmos/${productIdentifier}`;
    const apiUrl = `https://${S3_BUCKET_HOSTNAME}/?list-type=2&prefix=${encodeURIComponent(s3Prefix)}`;
    
    elements.s3PathDisplay.value = `s3://${S3_BUCKET_NAME}/${s3Prefix}`;
    logDebug('Constructed specific S3 API URL for query:', apiUrl);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`S3 API Error: Status ${response.status}`);
        const xmlText = await response.text();
        logDebug('Successfully fetched XML from S3.');

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");
        const errorNode = xmlDoc.querySelector('parsererror') || xmlDoc.querySelector('Error');
        if (errorNode) {
            const code = xmlDoc.querySelector('Code')?.textContent;
            const message = xmlDoc.querySelector('Message')?.textContent;
            throw new Error(`S3 or XML parsing error: ${code || 'Unknown'} - ${message || errorNode.innerText}`);
        }
        const contents = xmlDoc.getElementsByTagName('Contents');
        logDebug(`Found ${contents.length} objects matching the specific prefix.`);

        let filteredFiles = [];
        for (let item of contents) {
            const fullKey = item.getElementsByTagName('Key')[0].textContent;
            const key = fullKey.split('/').pop();
            const size = parseInt(item.getElementsByTagName('Size')[0].textContent, 10);
            
            const forecastHourMatch = key.match(/\.f(\d{3,4})/);
            if (forecastHourMatch) {
                const forecastHour = parseInt(forecastHourMatch[1], 10);
                if (requestedHours === null || requestedHours.has(forecastHour)) {
                    filteredFiles.push({ key, size, fullKey });
                }
            }
        }
        logDebug(`Filtered by forecast hour to ${filteredFiles.length} files.`);
        
        filteredFiles.sort((a, b) => {
            const fhrA = parseInt(a.key.match(/\.f(\d{3,4})/)[1], 10);
            const fhrB = parseInt(b.key.match(/\.f(\d{3,4})/)[1], 10);
            return fhrA - fhrB;
        });

        updateResultsTable(elements, filteredFiles);
        addInventoryButtons(elements);

    } catch (error) {
        if (error.name === 'AbortError') {
            setUIState(elements, false, `Error: The request timed out after ${FETCH_TIMEOUT / 1000} seconds.`);
        } else {
            setUIState(elements, false, `Error: ${error.message}`);
        }
        logDebug('An error occurred during data fetching:', error);
    } finally {
        setUIState(elements, false);
    }
}