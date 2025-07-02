// /work/viewer/colorbar.js

/**
 * Creates or updates a color bar legend and appends it to a DOM container.
 * @param {HTMLElement} container - The DOM element to append the color bar to.
 * @param {Function} colorScale - The function used to generate colors from values.
 * @param {number} minValue - The minimum value of the data range.
 * @param {number} maxValue - The maximum value of the data range.
 * @param {string} productName - The name of the displayed product.
 * @param {string} unit - The unit of the data values.
 * @param {number|null} labelIncrement - The increment for labels, or null for dynamic.
 */
export function updateColorBar(container, colorScale, minValue, maxValue, productName, unit, labelIncrement) {
    let colorBarDiv = container.querySelector('.info.legend');

    // If the color bar doesn't exist, create it.
    if (!colorBarDiv) {
        colorBarDiv = document.createElement('div');
        colorBarDiv.className = 'info legend';
        container.appendChild(colorBarDiv);
    }

    const range = maxValue - minValue;

    // Set the title
    colorBarDiv.innerHTML = `<h4 class="legend-title">${productName} (${unit})</h4>`;
    
    const legendBody = document.createElement('div');
    legendBody.className = 'legend-body';

    const gradient = document.createElement('div');
    gradient.className = 'legend-gradient';

    // Generate the CSS for the color gradient
    let gradientCss = 'linear-gradient(to top';
    for (let i = 0; i <= 100; i++) {
        const value = minValue + (i / 100) * range;
        const color = colorScale(value);
        if (color) {
            gradientCss += `, rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        }
    }
    gradientCss += ')';
    gradient.style.background = gradientCss;
    
    const labels = document.createElement('div');
    labels.className = 'legend-labels';
    labels.innerHTML = ''; // Clear previous labels

    // Generate labels based on the specified increment
    if (labelIncrement) {
        for (let value = maxValue; value >= minValue; value -= labelIncrement) {
            const label = document.createElement('span');
            label.textContent = Math.round(value);
            labels.appendChild(label);
        }
    } else {
        // Fallback to a fixed number of labels if no increment is provided
        const numLabels = 10;
        for (let i = 0; i <= numLabels; i++) {
            const value = maxValue - (i / numLabels) * range;
            const label = document.createElement('span');
            label.textContent = Math.round(value);
            labels.appendChild(label);
        }
    }
    
    legendBody.appendChild(gradient);
    legendBody.appendChild(labels);
    colorBarDiv.appendChild(legendBody);
}
