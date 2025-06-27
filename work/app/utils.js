// --- Utility Functions ---
export function logDebug(message, data = '') {
    if (true) { // DEBUG is on
        console.log(`[GFS Explorer LOG] ${new Date().toISOString()}: ${message}`, data);
    }
}

export function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function parseForecastHours(input) {
    if (!input.trim()) {
        logDebug('Forecast hour input is empty, will match all hours.');
        return null;
    }
    const hours = new Set();
    const parts = input.split(',').map(p => p.trim());
    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) hours.add(i);
            }
        } else {
            const num = Number(part);
            if (!isNaN(num)) hours.add(num);
        }
    }
    logDebug('Parsed forecast hours', Array.from(hours));
    return hours;
}

export function copyToClipboard(text, typeName, showMessage) {
    if (!text) {
        showMessage(`No ${typeName} to copy.`, 'info');
        return;
    }
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showMessage(`${typeName} copied to clipboard!`, 'success');
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        showMessage(`Failed to copy ${typeName}. Please copy manually.`, 'error');
    }
}