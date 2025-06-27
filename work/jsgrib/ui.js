// work/jsgrib/ui.js
import { getProduct } from './grib2-lookup.js';

// --- Plotting Logic ---
function showPlot(message) {
    const modal = document.getElementById('plot-modal');
    const plotContainer = document.getElementById('plot-container');
    const closeButton = modal.querySelector('.close-button');

    const product = getProduct(message.discipline, message.parameterCategory, message.parameterNumber);
    const title = `${product.name} (${product.shortName})`;
    const units = product.unit;

    // Reshape the 1D data array into a 2D grid for plotting
    const zData = [];
    if (message.grid_nx > 0 && message.grid_ny > 0) {
        for (let i = 0; i < message.grid_ny; i++) {
            zData.push(message.data.slice(i * message.grid_nx, (i + 1) * message.grid_nx));
        }
    }

    const plotData = [{
        z: zData,
        type: 'heatmap',
        colorscale: 'Viridis',
        colorbar: {
            title: units,
            titleside: 'right'
        }
    }];

    const layout = {
        title: title,
        xaxis: { title: 'Longitude Index' },
        yaxis: { title: 'Latitude Index', autorange: 'reversed' } // GRIB data is often top-to-bottom
    };

    Plotly.newPlot(plotContainer, plotData, layout);

    modal.style.display = 'block';

    closeButton.onclick = () => {
        modal.style.display = 'none';
        Plotly.purge(plotContainer); // Clear the plot to free memory
    };

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
            Plotly.purge(plotContainer);
        }
    };
}


export function renderMessagesTable(messages, container) {
    container.innerHTML = ''; // Clear previous results

    if (!messages || messages.length === 0) {
        container.innerHTML = '<p>No GRIB messages could be decoded from the file.</p>';
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    // Create table headers with new columns
    const headers = ['Msg #', 'Short Name', 'Full Name', 'Unit', 'Grid Template', 'Grid Dimensions', 'Actions'];
    const headerRow = document.createElement('tr');
    headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // Create table rows from the new metadata structure
    messages.forEach((metadata, index) => {
        const row = document.createElement('tr');

        // Use the lookup function with the corrected parameter fields
        const product = getProduct(metadata.discipline, metadata.parameterCategory, metadata.parameterNumber);
        
        const gridTemplate = metadata.grid_template !== undefined ? metadata.grid_template : 'N/A';
        const gridDimensions = (metadata.grid_nx && metadata.grid_ny && metadata.grid_nx > 0) ? `${metadata.grid_nx} x ${metadata.grid_ny}` : `${metadata.grid_num_points}`;

        row.innerHTML = `
            <td>${metadata.messageNumber}</td>
            <td>${product.shortName}</td>
            <td>${product.name}</td>
            <td>${product.unit}</td>
            <td>${gridTemplate}</td>
            <td>${gridDimensions}</td>
            <td><button class="view-btn" data-index="${index}">View Image</button></td>
        `;
        tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);

    // Add event listeners for the new "View" buttons
    container.querySelectorAll('.view-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const messageIndex = parseInt(e.target.dataset.index, 10);
            showPlot(messages[messageIndex]);
        });
    });
}