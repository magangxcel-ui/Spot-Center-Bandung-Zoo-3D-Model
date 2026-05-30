/**
 * map.js — Leaflet Minimap
 * Bandung Zoo Spatial Explorer
 * Koordinat: -6.8906, 107.6083 (Bandung Zoo)
 */

window.mapInstance = L.map('map', {
    zoomControl: true,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: false,
    attributionControl: false
}).setView([-6.8906, 107.6083], 17);

// Basemap satelit resolusi tinggi
L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
).addTo(window.mapInstance);

// Scale bar di pojok kiri bawah
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(window.mapInstance);

// Marker titik lokasi proyek
const siteIcon = L.divIcon({
    className: '',
    html: `
        <div style="
            position: relative;
            width: 16px; height: 16px;
        ">
            <div style="
                position: absolute; inset: 0;
                background: rgba(0,240,255,0.25);
                border-radius: 50%;
                animation: ripple 1.8s infinite;
            "></div>
            <div style="
                position: absolute; top: 50%; left: 50%;
                transform: translate(-50%,-50%);
                width: 10px; height: 10px;
                background: #00f0ff;
                border: 2px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 10px #00f0ff;
            "></div>
        </div>
        <style>
        @keyframes ripple {
            0% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(2.8); opacity: 0; }
        }
        </style>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

L.marker([-6.892211, 107.607611], { icon: siteIcon })
    .addTo(window.mapInstance)
    .bindTooltip('Bandung Zoo — Proyek Aktif', {
        permanent: false,
        direction: 'top',
        offset: [0, -10],
        className: 'map-tooltip'
    });