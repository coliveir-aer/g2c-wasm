// /work/viewer/colorbar.js

/**
 * Creates or updates a color bar legend on the map.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Function} colorScale - The function used to generate colors from values.
 * @param {number} minValue - The minimum value of the data range.
 * @param {number} maxValue - The maximum value of the data range.
 * @param {string} productName - The name of the displayed product (e.g., "2m Temperature").
 */
export function updateColorBar(map, colorScale, minValue, maxValue, productName) {
    let colorBar = map.colorBar;

    if (!colorBar) {
        colorBar = L.control({ position: 'bottomright' });

        colorBar.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            this._div = div;
            this.update(colorScale, minValue, maxValue, productName);
            return div;
        };

        colorBar.update = function (scale, min, max, name) {
            const div = this._div;
            div.innerHTML = `<h4 class="legend-title">${name}</h4>`;
            const gradient = document.createElement('div');
            gradient.className = 'legend-gradient';

            // Generate the gradient background from the color scale
            let gradientCss = 'linear-gradient(to right';
            for (let i = 0; i <= 100; i++) {
                const value = min + (i / 100) * (max - min);
                const color = scale(value);
                if (color) {
                    gradientCss += `, rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                }
            }
            gradientCss += ')';
            gradient.style.background = gradientCss;
            div.appendChild(gradient);

            // Add labels
            const labels = document.createElement('div');
            labels.className = 'legend-labels';
            labels.innerHTML = `<span>${min.toFixed(1)}</span><span>${((min + max) / 2).toFixed(1)}</span><span>${max.toFixed(1)}</span>`;
            div.appendChild(labels);
        };

        map.colorBar = colorBar;
        colorBar.addTo(map);
    }

    colorBar.update(colorScale, minValue, maxValue, productName);
}