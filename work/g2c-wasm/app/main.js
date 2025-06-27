import { logDebug, parseForecastHours, copyToClipboard } from './utils.js';
import { showMessage, setUIState, showInventoryView, updateSelectedCount, applyFilter } from './ui.js';
import { setupInventoryPanelListeners } from './inventory.js';
import { fetchGfsData } from './gfs-api.js';
import { S3_BUCKET_NAME, S3_BUCKET_URL_BASE } from './config.js';

// --- DOM Element References ---
const domElements = {
    dateSelector: document.getElementById('date-selector'),
    cycleSelector: document.getElementById('cycle-selector'),
    productSelector: document.getElementById('product-selector'),
    forecastHourSelector: document.getElementById('forecast-hour-selector'),
    queryButton: document.getElementById('query-button'),
    s3PathDisplay: document.getElementById('s3-path-display'),
    resultsTableBody: document.getElementById('results-body'),
    messageArea: document.getElementById('message-area'),
    loader: document.getElementById('loader'),
    resultsActions: document.getElementById('results-actions'),
    selectAllCheckbox: document.getElementById('select-all-checkbox'),
    downloadButton: document.getElementById('download-button'),
    selectedCountSpan: document.getElementById('selected-count'),
    resultsSummary: document.getElementById('results-summary'),
    copyLinksPanel: document.getElementById('copyLinksPanel'),
    copyHttpsLinkBtn: document.getElementById('copyHttpsLinkBtn'),
    copyS3LinkBtn: document.getElementById('copyS3LinkBtn'), 
    jsonOutputPanel: document.getElementById('jsonOutputPanel'),
    jsonDisplayArea: document.getElementById('jsonDisplayArea'),
    copyJsonBtn: document.getElementById('copyJsonBtn'),
    fileFilterInput: document.getElementById('file-filter-input'),
    filterIncludeRadio: document.getElementById('filter-include'),
    filterExcludeRadio: document.getElementById('filter-exclude'),
    copyQueryPythonBtn: document.getElementById('copyQueryPythonBtn'),
    downloadPythonBtn: document.getElementById('downloadPythonBtn'),
    resultsColumn: document.getElementById('results-column'),
    inventoryColumn: document.getElementById('inventory-column'),
    inventoryListContainer: document.getElementById('inventory-list-container'),
    closeInventoryBtn: document.getElementById('close-inventory-btn'),
    inventoryFilterInput: document.getElementById('inventory-filter-input'),
    downloadSubsetBtn: document.getElementById('download-subset-btn'),
    clearAllBtn: document.getElementById('clear-all-btn'),
    messageBox: document.createElement('div')
};
domElements.messageBox.className = 'message-box opacity-0 hidden';


// --- Python Code Generation ---
function generatePythonQueryCode() {
    const date = domElements.dateSelector.value.replace(/-/g, '');
    const cycle = domElements.cycleSelector.value;
    const product = domElements.productSelector.value;
    const forecastHoursInput = domElements.forecastHourSelector.value.trim();

    const parsedHours = forecastHoursInput ? JSON.stringify(Array.from(parseForecastHours(forecastHoursInput) || []).sort((a,b) => a-b)) : 'None';
    const filterTextInput = domElements.fileFilterInput.value.trim().toLowerCase();
    const filterModeInput = domElements.filterIncludeRadio.checked ? 'include' : 'exclude';
    const filenameFilter = filterTextInput ? `"${filterTextInput}"` : 'None';
    
    const pythonCode = `import boto3, os, re
from typing import List, Dict, Optional
import botocore
from botocore.config import Config

def query_gfs_data(
    date: str, cycle: str, product: str,
    forecast_hours: Optional[List[int]] = None,
    filename_filter: Optional[str] = None,
    filter_mode: str = "include",
    bucket_name: str = "${S3_BUCKET_NAME}"
) -> Dict:
    s3_client = boto3.client('s3', config=Config(signature_version=botocore.UNSIGNED))
    s3_prefix = f"gfs.{date}/{cycle}/atmos/gfs.t{cycle}z.{product}"
    all_keys = []
    paginator = s3_client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket_name, Prefix=s3_prefix):
        if 'Contents' in page:
            for obj in page['Contents']:
                full_key = obj['Key']
                filename_lower = os.path.basename(full_key).lower()
                if filename_filter and (filter_mode == "include" and filename_filter not in filename_lower or filter_mode == "exclude" and filename_filter in filename_lower):
                    continue
                f_hour_match = re.search(r'\\.f(\\d{3,4})', filename_lower)
                forecast_hour = int(f_hour_match.group(1)) if f_hour_match else None
                if forecast_hours is None or (forecast_hour is not None and forecast_hour in forecast_hours):
                    all_keys.append(full_key)
    all_keys.sort(key=lambda k: int(re.search(r'\\.f(\\d{3,4})', os.path.basename(k).lower()).group(1)) if re.search(r'\\.f(\\d{3,4})', os.path.basename(k).lower()) else 0)
    return {"bucket_name": bucket_name, "keys": all_keys}

if __name__ == "__main__":
    results = query_gfs_data(
        date="${date}", cycle="${cycle}", product="${product}",
        forecast_hours=${parsedHours},
        filename_filter=${filenameFilter},
        filter_mode="${filterModeInput}"
    )
    print(f"Found {len(results['keys'])} keys: {results['keys']}")
`;
    copyToClipboard(pythonCode, 'Python Query Code', (msg, type) => showMessage(domElements.messageBox, msg, type));
}

function generatePythonDownloadCode() {
    const currentJsonData = domElements.jsonDisplayArea.value;
    try {
        const parsedJson = JSON.parse(currentJsonData);
        if (!parsedJson.keys || parsedJson.keys.length === 0) {
             showMessage(domElements.messageBox, "No files selected to generate download code.", 'info');
             return;
        }
    } catch (e) {
        showMessage(domElements.messageBox, "Error parsing selected files JSON.", 'error');
        return;
    }
    const pythonCode = `import boto3, os, json
from typing import Dict
import botocore
from botocore.config import Config

def download_gfs_files(gfs_data_json: Dict, output_folder: str = "gfs_downloads"):
    s3_bucket = gfs_data_json.get("s3_bucket")
    s3_keys = gfs_data_json.get("keys", [])
    if not all([s3_bucket, s3_keys]):
        print("Invalid JSON data or no files to download.")
        return
    s3_client = boto3.client('s3', config=Config(signature_version=botocore.UNSIGNED))
    os.makedirs(output_folder, exist_ok=True)
    for s3_key in s3_keys:
        local_filepath = os.path.join(output_folder, os.path.basename(s3_key))
        try:
            print(f"Downloading s3://{s3_bucket}/{s3_key}")
            s3_client.download_file(s3_bucket, s3_key, local_filepath)
        except Exception as e:
            print(f"Error downloading {s3_key}: {e}")
    print("Download complete.")

if __name__ == "__main__":
    selected_gfs_files = ${currentJsonData}
    download_gfs_files(selected_gfs_files)
`;
    copyToClipboard(pythonCode, 'Python Download Code', (msg, type) => showMessage(domElements.messageBox, msg, type));
}
        
function downloadSelectedFiles() {
    const selectedCheckboxes = Array.from(document.querySelectorAll('#results-body input[type="checkbox"]:checked')).filter(cb => {
        const row = cb.closest('tr');
        return row && row.style.display !== 'none';
    });
    if (selectedCheckboxes.length === 0) {
        showMessage(domElements.messageBox, 'No files selected for download.', 'info');
        return;
    }
    selectedCheckboxes.forEach((checkbox, index) => {
        const fullFileKey = checkbox.dataset.fullkey;
        const fileName = fullFileKey.split('/').pop();
        const downloadUrl = `${S3_BUCKET_URL_BASE}${fullFileKey}`;
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, index * 200);
    });
    showMessage(domElements.messageBox, `Initiated download for ${selectedCheckboxes.length} files.`, 'success');
}


// --- Event Listeners & Initialization ---
window.addEventListener('load', () => {
    logDebug('Page loaded. Initializing application.');
    
    document.querySelector('.container').insertBefore(domElements.messageBox, document.querySelector('footer'));

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    domElements.dateSelector.value = yesterday.toISOString().split('T')[0];
    logDebug('Default date set to:', domElements.dateSelector.value);

    setupInventoryPanelListeners(domElements);

    domElements.queryButton.addEventListener('click', () => fetchGfsData(domElements));
    domElements.downloadButton.addEventListener('click', downloadSelectedFiles);
    domElements.selectAllCheckbox.addEventListener('change', () => {
        const isChecked = domElements.selectAllCheckbox.checked;
        document.querySelectorAll('#results-body input[type="checkbox"]').forEach(cb => {
            const row = cb.closest('tr');
            if (row && row.style.display !== 'none') {
                cb.checked = isChecked;
            }
        });
        updateSelectedCount(domElements);
    });
    
    domElements.resultsTableBody.addEventListener('change', (event) => {
        if (event.target.classList.contains('file-checkbox')) {
            updateSelectedCount(domElements);
        }
    });

    domElements.forecastHourSelector.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            domElements.queryButton.click();
        }
    });

    domElements.fileFilterInput.addEventListener('input', () => applyFilter(domElements));
    domElements.filterIncludeRadio.addEventListener('change', () => applyFilter(domElements));
    domElements.filterExcludeRadio.addEventListener('change', () => applyFilter(domElements));

    domElements.copyQueryPythonBtn.addEventListener('click', generatePythonQueryCode);
    domElements.downloadPythonBtn.addEventListener('click', generatePythonDownloadCode);
    
    domElements.copyJsonBtn.addEventListener('click', () => copyToClipboard(domElements.jsonDisplayArea.value, 'JSON', (msg, type) => showMessage(domElements.messageBox, msg, type)));
    
    domElements.closeInventoryBtn.addEventListener('click', () => {
        showInventoryView(domElements, false);
    });
});