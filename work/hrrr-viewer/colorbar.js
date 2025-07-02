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

    // Make the color bar draggable
    makeDraggable(colorBarDiv);
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = element.querySelector(".legend-title");

    if (header) {
        // if present, the header is where you move the DIV from:
        header.onmousedown = dragMouseDown;
    } else {
        // otherwise, move the DIV from anywhere inside the DIV:
        element.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        
        // Remove bottom/right positioning to prevent resizing conflicts
        element.style.right = 'auto';
        element.style.bottom = 'auto';

        // get the mouse cursor position at startup:
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        // call a function whenever the cursor moves:
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        // calculate the new cursor position:
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        // set the element's new position:
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        // stop moving when mouse button is released:
        document.onmouseup = null;
        document.onmousemove = null;
    }
}
