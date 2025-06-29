// /work/jsgrib/ui.js
import { getProduct } from './grib2-lookup.js';

/**
 * Renders the table of decoded GRIB messages.
 * @param {Array<object>} messages - An array of the fully decoded message objects.
 * @param {HTMLElement} container - The HTML element to render the table into.
 */
export function renderMessagesTable(messages, container) {
    container.innerHTML = ''; // Clear previous results

    if (!messages || messages.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-4">No GRIB messages could be decoded from the file.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200';
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    const tbody = document.createElement('tbody');
    tbody.className = 'bg-white divide-y divide-gray-200';

    // Create table headers
    const headers = ['Msg #', 'Short Name', 'Full Name', 'Level', 'Grid Dimensions', 'Actions'];
    const headerRow = document.createElement('tr');
    headers.forEach(text => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = text;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // Create table rows for each message
    messages.forEach((decodedData, index) => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';

        const { metadata } = decodedData;
        // CORRECTED: Access the product definition through the 'sections' object
        const product = getProduct(metadata.info.discipline, metadata.sections.product_definition.data[0], metadata.sections.product_definition.data[1]);
        const gridDimensions = `${metadata.grid.nx} x ${metadata.grid.ny}`;
        // CORRECTED: Access the level from the correct path
        const level = metadata.sections.product_definition.data[4]; 

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${decodedData.messageNumber}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${product.shortName}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${product.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${level}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${gridDimensions}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <button class="view-btn text-indigo-600 hover:text-indigo-900" data-index="${index}">View Map</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
}
