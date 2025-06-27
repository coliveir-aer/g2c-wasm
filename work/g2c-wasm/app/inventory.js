import { logDebug } from './utils.js';
import { showMessage, setUIState, showInventoryView } from './ui.js';
import { S3_BUCKET_URL_BASE } from './config.js';

let currentGribFileKey = ''; // Store the key of the file being inventoried

function updateHeaderBadge(headerElement) {
    const levelsContainer = headerElement.nextElementSibling;
    if (!levelsContainer) return;
    const selectedCount = levelsContainer.querySelectorAll('.inventory-checkbox:checked').length;
    let badge = headerElement.querySelector('.selection-badge');

    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'selection-badge bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded-full';
        const controls = headerElement.querySelector('.header-controls');
        if (controls) controls.appendChild(badge);
    }

    if (selectedCount > 0) {
        badge.textContent = selectedCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function parseAndGroupInventory(idxText) {
    const lines = idxText.split('\n').filter(line => line.trim() !== '');
    const groupedData = {};

    const startBytes = lines.map(line => {
        const fields = line.split(':');
        return fields.length > 1 ? parseInt(fields[1], 10) : null;
    });

    lines.forEach((line, index) => {
        const fields = line.split(':');
        if (fields.length > 5) {
            const msgNum = fields[0];
            const productName = fields[3];
            const level = fields[4];
            const startByte = startBytes[index];
            const endByte = (index < startBytes.length - 1 && startBytes[index+1]) ? startBytes[index+1] - 1 : undefined;

            if (!groupedData[productName]) {
                groupedData[productName] = [];
            }
            groupedData[productName].push({
                level: level,
                msgNum: msgNum,
                startByte: startByte,
                endByte: endByte
            });
        }
    });
    return groupedData;
}

function renderInventoryUI(inventoryData, elements) {
    elements.inventoryListContainer.innerHTML = '';
    
    if (Object.keys(inventoryData).length === 0) {
        elements.inventoryListContainer.innerHTML = '<div class="text-center p-4">Could not parse any inventory items.</div>';
        return;
    }

    const sortedProducts = Object.keys(inventoryData).sort();

    for (const productName of sortedProducts) {
        const productDiv = document.createElement('div');
        productDiv.className = 'mb-2 product-group';
        productDiv.dataset.productName = productName.toLowerCase();

        const productHeader = document.createElement('h4');
        productHeader.className = 'text-md font-semibold text-gray-700 bg-gray-100 p-2 rounded-md border flex items-center justify-between cursor-pointer';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'product-name font-bold';
        nameSpan.textContent = productName;
        
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'header-controls flex items-center gap-4 ml-auto';
        
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'inline-flex rounded-md shadow-sm';
        buttonGroup.innerHTML = `
            <button type="button" class="select-all-group text-xs py-1 px-2 bg-gray-200 hover:bg-gray-300 rounded-l-lg">All</button>
            <button type="button" class="select-none-group text-xs py-1 px-2 bg-gray-200 hover:bg-gray-300 rounded-r-lg border-l border-gray-400">None</button>
        `;

        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon transform transition-transform duration-200 ml-4';
        expandIcon.innerHTML = '▸';
        
        controlsContainer.appendChild(buttonGroup);
        productHeader.appendChild(nameSpan);
        productHeader.appendChild(controlsContainer);
        productHeader.appendChild(expandIcon);
        productDiv.appendChild(productHeader);
        
        const levelsContainer = document.createElement('div');
        levelsContainer.className = 'p-2 border border-t-0 rounded-b-md hidden';
        
        inventoryData[productName].forEach(item => {
            const levelDiv = document.createElement('div');
            levelDiv.className = 'flex items-center space-x-2 p-1';
            
            const checkboxId = `inv-check-${item.msgNum}`;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = checkboxId;
            checkbox.value = item.msgNum;
            checkbox.dataset.startByte = item.startByte;
            checkbox.dataset.endByte = item.endByte || '';
            checkbox.className = 'h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 inventory-checkbox';
            
            const label = document.createElement('label');
            label.htmlFor = checkboxId;
            label.textContent = item.level;
            label.className = 'text-sm text-gray-800';

            checkbox.addEventListener('change', () => updateHeaderBadge(productHeader));

            levelDiv.appendChild(checkbox);
            levelDiv.appendChild(label);
            levelsContainer.appendChild(levelDiv);
        });

        productHeader.addEventListener('click', () => {
            levelsContainer.classList.toggle('hidden');
            expandIcon.classList.toggle('rotate-90');
        });

        controlsContainer.addEventListener('click', (e) => e.stopPropagation());

        productHeader.querySelector('.select-all-group').addEventListener('click', () => {
            levelsContainer.querySelectorAll('.inventory-checkbox').forEach(cb => cb.checked = true);
            updateHeaderBadge(productHeader);
        });
        productHeader.querySelector('.select-none-group').addEventListener('click', () => {
            levelsContainer.querySelectorAll('.inventory-checkbox').forEach(cb => cb.checked = false);
            updateHeaderBadge(productHeader);
        });

        productDiv.appendChild(levelsContainer);
        elements.inventoryListContainer.appendChild(productDiv);
        updateHeaderBadge(productHeader);
    }
}

async function getSelectedGribSubsetBlob(elements) {
    const checkedBoxes = document.querySelectorAll('.inventory-checkbox:checked');
    if (checkedBoxes.length === 0) {
        showMessage(elements.messageBox, 'No inventory items selected.', 'info');
        return null;
    }

    showMessage(elements.messageBox, `Fetching ${checkedBoxes.length} GRIB messages...`, 'info');
    const gribFileUrl = `${S3_BUCKET_URL_BASE}${currentGribFileKey}`;
    const rangesToFetch = Array.from(checkedBoxes).map(box => ({
        start: box.dataset.startByte,
        end: box.dataset.endByte
    }));

    try {
        const fetchPromises = rangesToFetch.map(range => {
            const headers = { Range: `bytes=${range.start}-${range.end || ''}` };
            return fetch(gribFileUrl, { headers });
        });
        const responses = await Promise.all(fetchPromises);
        
        for(const res of responses) {
            if (!res.ok) throw new Error(`Failed to fetch byte range: ${res.statusText}`);
        }
        const arrayBuffers = await Promise.all(responses.map(res => res.arrayBuffer()));
        return new Blob(arrayBuffers, { type: 'application/octet-stream' });
    } catch (error) {
        console.error('Error downloading subset:', error);
        showMessage(elements.messageBox, `Error creating subset: ${error.message}`, 'error');
        return null;
    }
}

function triggerDownload(blob, filename, elements) {
    if (!blob) return;
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    showMessage(elements.messageBox, 'Download complete!', 'success');
}

export function setupInventoryPanelListeners(elements) {
    logDebug('Initializing inventory panel listeners...');
    
    elements.inventoryFilterInput.addEventListener('input', (e) => {
        const filterText = e.target.value.toLowerCase();
        document.querySelectorAll('.product-group').forEach(group => {
            const hasSelection = group.querySelector('.inventory-checkbox:checked');
            const productName = group.dataset.productName;

            if (hasSelection || productName.includes(filterText)) {
                group.style.display = '';
            } else {
                group.style.display = 'none';
            }
        });
    });

    elements.downloadSubsetBtn.addEventListener('click', async () => {
        const gribBlob = await getSelectedGribSubsetBlob(elements);
        if (gribBlob) {
            triggerDownload(gribBlob, `subset_${currentGribFileKey.split('/').pop()}`, elements);
        }
    });

    elements.clearAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.inventory-checkbox').forEach(cb => {
            if (cb.checked) {
                cb.checked = false;
            }
        });
        document.querySelectorAll('h4.text-md').forEach(header => updateHeaderBadge(header));
    });
}

async function processGribInventory(gribFullKey, elements) {
    currentGribFileKey = gribFullKey;
    elements.inventoryColumn.dataset.gribFileKey = gribFullKey;

    elements.inventoryListContainer.innerHTML = '<div class="text-center p-4">Fetching and processing index file...</div>';
    showInventoryView(elements, true);
    logDebug(`Starting inventory process for ${gribFullKey}`);

    const idxKey = gribFullKey + '.idx';
    const idxUrl = `${S3_BUCKET_URL_BASE}${idxKey}`;
    
    try {
        setUIState(elements, true, 'Fetching GRIB Index...');
        const response = await fetch(idxUrl);
        if (!response.ok) throw new Error(`Could not fetch index file: ${response.status}`);
        const idxText = await response.text();

        const inventoryData = parseAndGroupInventory(idxText);
        renderInventoryUI(inventoryData, elements);
        setUIState(elements, false);

    } catch (error) {
        elements.inventoryListContainer.innerHTML = `<div class="text-center p-4 text-red-600">Error: ${error.message}</div>`;
        setUIState(elements, false);
    }
}

export function addInventoryButtons(elements) {
    const headerRow = document.querySelector('#results-table thead tr');
    if (headerRow && !headerRow.querySelector('.actions-header')) {
        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider actions-header';
        th.textContent = 'Actions';
        headerRow.appendChild(th);
    }

    document.querySelectorAll('#results-body tr').forEach(row => {
        if (row.querySelector('.inventory-btn-cell')) return;

        const actionCell = document.createElement('td');
        actionCell.className = 'inventory-btn-cell px-4 py-2 whitespace-nowrap';
        
        const fileCheckbox = row.querySelector('input.file-checkbox');
        if (fileCheckbox) {
            const fullKey = fileCheckbox.dataset.fullkey;
            
            if (fullKey && !fullKey.endsWith('.idx')) {
                const button = document.createElement('button');
                button.textContent = 'Inv';
                button.className = 'inventory-btn bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold py-1 px-2 rounded';
                button.title = 'View GRIB Inventory';
                button.onclick = () => processGribInventory(fullKey, elements);
                actionCell.appendChild(button);
            }
        }
        row.appendChild(actionCell);
    });
}