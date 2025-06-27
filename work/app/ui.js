import { formatBytes } from './utils.js';
import { S3_BUCKET_NAME, S3_BUCKET_HOSTNAME } from './config.js';
import { copyToClipboard } from './utils.js';

let allFetchedFiles = [];

export function showMessage(messageBox, message, type) {
    messageBox.textContent = message;
    messageBox.className = `message-box p-4 rounded-lg opacity-100 ${
        type === 'success' ? 'bg-green-100 text-green-700' : 
        type === 'info' ? 'bg-blue-100 text-blue-700' :
        'bg-red-100 text-red-700'
    }`;
    messageBox.classList.remove('hidden');
    setTimeout(() => {
        messageBox.classList.add('opacity-0');
        setTimeout(() => messageBox.classList.add('hidden'), 300);
    }, 3000);
}

export function setUIState(elements, isLoading, message = null) {
    elements.queryButton.disabled = isLoading;
    if (isLoading) {
        elements.loader.classList.remove('hidden');
        elements.queryButton.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        elements.loader.classList.add('hidden');
        elements.queryButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    if (message) {
        if (message !== 'Fetching GRIB Index...') {
            elements.resultsTableBody.innerHTML = '';
            elements.resultsActions.classList.add('hidden');
            elements.copyLinksPanel.classList.add('hidden');
            elements.jsonOutputPanel.classList.add('hidden');
            showInventoryView(elements, false);
        }
        elements.messageArea.textContent = message;
        elements.messageArea.classList.remove('hidden');
    } else {
        elements.messageArea.classList.add('hidden');
    }
}

export function showInventoryView(elements, show) {
    if (show) {
        elements.resultsColumn.classList.remove('lg:col-span-9');
        elements.resultsColumn.classList.add('lg:col-span-5');
        elements.inventoryColumn.classList.remove('hidden');
        elements.inventoryColumn.classList.add('flex');
    } else {
        elements.inventoryColumn.classList.add('hidden');
        elements.inventoryColumn.classList.remove('flex');
        elements.resultsColumn.classList.remove('lg:col-span-5');
        elements.resultsColumn.classList.add('lg:col-span-9');
    }
}

export function updateSelectedCount(elements) {
    const allCheckboxes = document.querySelectorAll('#results-body input[type="checkbox"]');
    const visibleCheckedCheckboxes = Array.from(allCheckboxes).filter(cb => {
        const row = cb.closest('tr');
        return row && row.style.display !== 'none' && cb.checked;
    });
    const visibleCheckedCount = visibleCheckedCheckboxes.length;

    elements.selectedCountSpan.textContent = visibleCheckedCount;
    elements.downloadButton.disabled = visibleCheckedCount === 0;
    elements.downloadButton.classList.toggle('opacity-50', visibleCheckedCount === 0);
    elements.downloadButton.classList.toggle('cursor-not-allowed', visibleCheckedCount === 0);

    elements.copyLinksPanel.classList.toggle('hidden', visibleCheckedCount !== 1);
    elements.jsonOutputPanel.classList.toggle('hidden', visibleCheckedCount < 1);

    if (visibleCheckedCount === 1) {
        const selectedCheckbox = visibleCheckedCheckboxes[0];
        const fullKey = selectedCheckbox.dataset.fullkey;
        elements.copyHttpsLinkBtn.onclick = () => copyToClipboard(`https://${S3_BUCKET_HOSTNAME}/${fullKey}`, 'HTTPS link', (msg, type) => showMessage(elements.messageBox, msg, type));
        elements.copyS3LinkBtn.onclick = () => copyToClipboard(`s3://${S3_BUCKET_NAME}/${fullKey}`, 'S3 URI', (msg, type) => showMessage(elements.messageBox, msg, type)); 
    }
    
    if (visibleCheckedCount >= 1) {
        const visibleCheckedKeys = visibleCheckedCheckboxes.map(cb => cb.dataset.fullkey);
        elements.jsonDisplayArea.value = JSON.stringify({
            http_prefix: `https://${S3_BUCKET_HOSTNAME}/`,
            s3_bucket: S3_BUCKET_NAME,
            keys: visibleCheckedKeys
        }, null, 2);
    } else {
        elements.jsonDisplayArea.value = JSON.stringify({
            http_prefix: `https://${S3_BUCKET_HOSTNAME}/`,
            s3_bucket: S3_BUCKET_NAME,
            keys: []
        }, null, 2);
    }
}

export function applyFilter(elements) {
    const filterText = elements.fileFilterInput.value.toLowerCase().trim();
    const filterMode = elements.filterIncludeRadio.checked ? 'include' : 'exclude';
    let visibleFileCount = 0;

    document.querySelectorAll('#results-body tr').forEach(row => {
        const filename = row.dataset.filename || '';
        let shouldShow = !filterText || (filterMode === 'include' ? filename.includes(filterText) : !filename.includes(filterText));
        row.style.display = shouldShow ? '' : 'none';
        if (shouldShow) visibleFileCount++;
    });
    elements.resultsSummary.textContent = `Displaying ${visibleFileCount} of ${allFetchedFiles.length} files.`;
    updateSelectedCount(elements);
}

export function updateResultsTable(elements, files) {
    elements.resultsTableBody.innerHTML = '';
    allFetchedFiles = files;

    if (files.length === 0) {
        setUIState(elements, false, 'No GFS data found matching your criteria.');
        return;
    }

    files.forEach(file => {
        const forecastHourMatch = file.key.match(/\.f(\d{3,4})/);
        const forecastHour = forecastHourMatch ? parseInt(forecastHourMatch[1], 10) : 'N/A';
        const row = document.createElement('tr');
        row.classList.add('hover:bg-gray-100', 'transition-colors', 'duration-150');
        row.dataset.filename = file.key.toLowerCase();
        row.innerHTML = `
            <td class="px-4 py-2 whitespace-nowrap"><input type="checkbox" data-fullkey="${file.fullKey}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 file-checkbox"></td>
            <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-800 font-medium">${file.key}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${forecastHour} hr</td>
            <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatBytes(file.size)}</td>
        `;
        elements.resultsTableBody.appendChild(row);
    });

    elements.messageArea.classList.add('hidden');
    elements.resultsActions.classList.remove('hidden');
    
    applyFilter(elements);
    document.querySelectorAll('.file-checkbox').forEach(cb => cb.addEventListener('change', () => updateSelectedCount(elements)));
}