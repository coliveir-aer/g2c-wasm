// /work/viewer/colorbar.js

/**
 * Creates or updates a color bar legend on the map.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Function} colorScale - The function used to generate colors from values.
 * @param {number} minValue - The minimum value of the data range.
 * @param {number} maxValue - The maximum value of the data range.
 * @param {string} productName - The name of the displayed product.
 * @param {string} unit - The unit of the data values.
 * @param {number|null} labelIncrement - The increment for labels, or null for dynamic.
 */
export function updateColorBar(map, colorScale, minValue, maxValue, productName, unit, labelIncrement) {
    let colorBar = map.colorBar;

    if (!colorBar) {
        colorBar = L.control({ position: 'bottomright' });

        colorBar.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            this._div = div;
            this.update(colorScale, minValue, maxValue, productName, unit, labelIncrement);
            return div;
        };

        colorBar.update = function (scale, min, max, name, unit, increment) {
            const div = this._div;
            const range = max - min;

            div.innerHTML = `<h4 class="legend-title">${name} (${unit})</h4>`;
            
            const legendBody = document.createElement('div');
            legendBody.className = 'legend-body';

            const gradient = document.createElement('div');
            gradient.className = 'legend-gradient';

            let gradientCss = 'linear-gradient(to top';
            for (let i = 0; i <= 100; i++) {
                const value = min + (i / 100) * range;
                const color = scale(value);
                if (color) {
                    gradientCss += `, rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                }
            }
            gradientCss += ')';
            gradient.style.background = gradientCss;
            
            const labels = document.createElement('div');
            labels.className = 'legend-labels';
            labels.innerHTML = ''; // Clear previous labels

            if (increment) {
                // Generate labels at fixed increments
                for (let value = max; value >= min; value -= increment) {
                    const label = document.createElement('span');
                    label.textContent = Math.round(value);
                    labels.appendChild(label);
                }
            } else {
                // Generate a fixed number of evenly spaced labels
                const numLabels = 10;
                for (let i = 0; i <= numLabels; i++) {
                    const value = max - (i / numLabels) * range;
                    const label = document.createElement('span');
                    label.textContent = Math.round(value);
                    labels.appendChild(label);
                }
            }
            
            legendBody.appendChild(gradient);
            legendBody.appendChild(labels);
            div.appendChild(legendBody);
        };

        map.colorBar = colorBar;
        colorBar.addTo(map);
    }

    colorBar.update(colorScale, minValue, maxValue, productName, unit, labelIncrement);
}
