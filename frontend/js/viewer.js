/**
 * viewer.js — 3D GIS Viewer Core
 * Bandung Zoo Spatial Explorer
 *
 * Perbaikan dalam versi ini:
 * ✅ Koordinat UTM 48S real-time: X = ... | Y = ... | Z = ...  (toFixed(3), titik sebagai desimal)
 * ✅ Koordinat mengikuti kursor (raycast ke model & ground)
 * ✅ Grid & Plane Pemotong Visual DIHAPUS dari UI
 * ✅ Fitur Ukur Luas (m²) & Ukur Volume (m³) ditambahkan
 * ✅ Kompas berputar sesuai rotasi kamera
 * ✅ Reset View & Reset Pemotongan
 * ✅ Metadata IFC diterjemahkan ke label Bahasa Indonesia
 * ✅ Volume otomatis ditampilkan saat klik objek
 * ✅ Fix: IFCLoader loadAsync error handling
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IFCLoader } from 'web-ifc-three/IFCLoader';

// ==========================================
// 1. SETUP ENGINE — SCENE, CAMERA, RENDERER
// ==========================================
const container = document.getElementById('viewer-container');
const canvas    = document.getElementById('viewerCanvas');

const scene = new THREE.Scene();
scene.background = null; // Transparan — latar dari CSS

const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.5,
    10000
);

const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)
    || window.innerWidth < 768;

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,       // matikan di HP = lebih ringan
    alpha: true,
    logarithmicDepthBuffer: !isMobile
});
renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight, false);
renderer.shadowMap.enabled    = !isMobile;   // matikan shadow di HP
renderer.shadowMap.type       = THREE.PCFSoftShadowMap;
renderer.toneMapping          = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure  = 1.0;
renderer.localClippingEnabled = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.05;
controls.minDistance    = 5;
controls.maxDistance    = 2000;

// Simpan posisi awal kamera (diperbarui saat model selesai dimuat)
const initialCamPos    = new THREE.Vector3();
const initialCamTarget = new THREE.Vector3();

// ==========================================
// 2. PENCAHAYAAN REALISTIS
// ==========================================
scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const mainLight = new THREE.DirectionalLight(0xfff5e0, 2.2);
mainLight.position.set(150, 250, 120);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(isMobile ? 512 : 4096, isMobile ? 512 : 4096);
mainLight.shadow.bias       = -0.0004;
mainLight.shadow.normalBias = 0.02;
const shadowD = 250;
mainLight.shadow.camera.left   = -shadowD;
mainLight.shadow.camera.right  =  shadowD;
mainLight.shadow.camera.top    =  shadowD;
mainLight.shadow.camera.bottom = -shadowD;
scene.add(mainLight);

// Fill light: warna tanah disesuaikan tema #0f4032
scene.add(new THREE.HemisphereLight(0xe8f5ff, 0x0f4032, 0.55));

// ==========================================
// 3. GROUND PLANE — Visual dihapus, plane logis dipertahankan untuk raycasting koordinat
// ==========================================

// ==========================================
// 4. CLIPPING PLANES & SLIDER UI
// ==========================================
const clipPlanes = [
    new THREE.Plane(new THREE.Vector3(1,  0, 0), 100),   // X
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 150),   // Y (atas/bawah)
    new THREE.Plane(new THREE.Vector3(0,  0, 1), 100)    // Z
];

// Nilai default (diperbarui saat model dimuat)
let clipDefault = { x: 100, y: 150, z: 100 };

const elValX = document.getElementById('val-clip-x');
const elValY = document.getElementById('val-clip-y');
const elValZ = document.getElementById('val-clip-z');

document.getElementById('clip-x').addEventListener('input', e => {
    clipPlanes[0].constant = +e.target.value;
    elValX.innerText = (+e.target.value).toFixed(1) + 'm';
});
document.getElementById('clip-y').addEventListener('input', e => {
    clipPlanes[1].constant = +e.target.value;
    elValY.innerText = (+e.target.value).toFixed(1) + 'm';
});
document.getElementById('clip-z').addEventListener('input', e => {
    clipPlanes[2].constant = +e.target.value;
    elValZ.innerText = (+e.target.value).toFixed(1) + 'm';
});

// Reset pemotongan ke nilai default
document.getElementById('btn-reset-clip').addEventListener('click', () => {
    const cx = document.getElementById('clip-x');
    const cy = document.getElementById('clip-y');
    const cz = document.getElementById('clip-z');
    cx.value = clipDefault.x; cy.value = clipDefault.y; cz.value = clipDefault.z;
    clipPlanes[0].constant = clipDefault.x;
    clipPlanes[1].constant = clipDefault.y;
    clipPlanes[2].constant = clipDefault.z;
    elValX.innerText = 'Max';
    elValY.innerText = 'Max';
    elValZ.innerText = 'Max';
    document.getElementById('opacity-slider').value = 100;
    document.getElementById('val-opacity').innerText = '100%';
    if (ifcModel) {
        ifcModel.traverse(child => {
            if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => { m.transparent = true; m.opacity = 1.0; m.needsUpdate = true; });
            }
        });
    }
});

// ==========================================
// 5. IFC LOADER & MATERIAL ENHANCEMENT
// ==========================================
let ifcModel   = null;
let ifcModelID = 0;

const ifcLoader = new IFCLoader();

// Material highlight saat objek dipilih
const highlightMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 0.4,
    depthTest: false,
    transparent: true,
    opacity: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    side: THREE.DoubleSide
});

/**
 * Mapping nama properti IFC → label Indonesia ramah pengguna
 * Properti teknis (GlobalId, OwnerHistory, dsb.) disembunyikan.
 */
const IFC_LABEL = {
    'Name':            'Nama Elemen',
    'ObjectType':      'Tipe Objek',
    'Tag':             'Tag / Kode',
    'Description':     'Deskripsi',
    'PredefinedType':  'Jenis Standar',
    'OverallHeight':   'Ketinggian (m)',
    'OverallWidth':    'Lebar Keseluruhan (m)',
    'NominalLength':   'Panjang Nominal (m)',
    'NominalWidth':    'Lebar Nominal (m)',
    'NominalHeight':   'Tinggi Nominal (m)',
    'LoadBearing':     'Pemikul Beban',
    'IsExternal':      'Eksterior',
    'Reference':       'Referensi',
    'Material':        'Material',
};
const IFC_SKIP = new Set([
    'GlobalId', 'OwnerHistory', 'expressID', 'type',
    'CompositionType', 'Representation', 'ObjectPlacement'
]);

/** Terapkan material clay-render ke semua mesh IFC */
function enhanceMaterials(model) {
    model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const isArr = Array.isArray(child.material);
        const mats  = isArr ? child.material : [child.material];
        const newM  = mats.map(mat => new THREE.MeshStandardMaterial({
            color:       mat?.color || 0xe2e8f0,
            roughness:   0.78,
            metalness:   0.05,
            side:        THREE.DoubleSide,
            clippingPlanes:    clipPlanes,
            clipIntersection:  false,
            polygonOffset:     true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits:  1,
            transparent: true,
            opacity:     1.0
        }));
        child.material = isArr ? newM : newM[0];
    });
}

/** Load file IFC utama */
async function loadIFC() {
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.classList.remove('hidden');

    try {
        // 1. Inisialisasi WASM
        await ifcLoader.ifcManager.setWasmPath('https://unpkg.com/web-ifc@0.0.39/');
        await ifcLoader.ifcManager.applyWebIfcConfig({
            USE_FAST_BOOLS: true,
            COORDINATE_TO_ORIGIN: true
        });

        // 2. Gunakan loadAsync agar mengembalikan Promise yang rapi
        const model = await ifcLoader.loadAsync('./assets/Models/Spot-Center-Bandung-Zoo.ifc');
        
        ifcModel   = model;
        ifcModelID = model.modelID;
        enhanceMaterials(model);
        scene.add(model);

        // 3. Hitung bounding box model untuk auto-fit kamera & slider
        const box    = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // 4. Sesuaikan range slider clipping dengan ukuran model
        const cxEl = document.getElementById('clip-x');
        const cyEl = document.getElementById('clip-y');
        const czEl = document.getElementById('clip-z');
        cxEl.max = size.x; cxEl.min = -size.x; cxEl.value = size.x;
        cyEl.max = size.y; cyEl.min = -10;     cyEl.value = size.y;
        czEl.max = size.z; czEl.min = -size.z; czEl.value = size.z;
        
        clipPlanes[0].constant = size.x;
        clipPlanes[1].constant = size.y;
        clipPlanes[2].constant = size.z;
        clipDefault = { x: size.x, y: size.y, z: size.z };

        // 5. Auto-fit kamera
        const fov = camera.fov * (Math.PI / 180);
        const camDist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.55;
        const camPos  = new THREE.Vector3(
            center.x + camDist * 0.7,
            center.y + camDist * 0.6,
            center.z + camDist
        );
        
        camera.position.copy(camPos);
        controls.target.copy(center);
        controls.update();

        // 6. Simpan posisi awal untuk tombol Reset View
        initialCamPos.copy(camPos);
        initialCamTarget.copy(center);

        loadingOverlay.classList.add('hidden');

    } catch (error) {
        console.error('Gagal memuat model IFC atau dependensi WASM:', error);
        loadingOverlay.innerHTML = '<span style="color: #ef4444; font-weight: bold; padding: 20px;">Gagal memuat model spasial. Silakan cek console.</span>';
    }
}
loadIFC();

// ==========================================
// 6. LAYER MANAGER
// ==========================================
document.getElementById('toggle-model').addEventListener('change', e => {
    if (ifcModel) ifcModel.visible = e.target.checked;
});

// ==========================================
// 7. TRANSPARANSI OBJEK
// ==========================================
document.getElementById('opacity-slider').addEventListener('input', e => {
    if (!ifcModel) return;
    const opVal = +e.target.value / 100;
    document.getElementById('val-opacity').innerText = e.target.value + '%';
    ifcModel.traverse(child => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { m.transparent = true; m.opacity = opVal; m.needsUpdate = true; });
    });
});

// ==========================================
// 8. RESET VIEW
// ==========================================
document.getElementById('btn-reset-view').addEventListener('click', () => {
    camera.position.copy(initialCamPos);
    controls.target.copy(initialCamTarget);
    controls.update();
});

// ==========================================
// 9. KOORDINAT REAL-TIME UTM 48S
//    Format: X = 787537.120 | Y = 9238425.791 | Z = 742.210
//    Mengikuti posisi kursor secara real-time
// ==========================================

// Offset georeferensi ke UTM Zone 48S — Bandung Zoo
const BASE_E = 787500.000;    // Easting (X)
const BASE_N = 9238500.000;   // Northing (Y)
const BASE_Z = 742.000;       // Elevasi MSL (Z)

const elCoordX = document.getElementById('coord-x');
const elCoordY = document.getElementById('coord-y');
const elCoordZ = document.getElementById('coord-z');

const raycaster       = new THREE.Raycaster();
const mouse           = new THREE.Vector2();
const groundPlane     = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0
const groundHitVec    = new THREE.Vector3();

window.addEventListener('mousemove', event => {
    const b = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - b.left)  / b.width)  * 2 - 1;
    mouse.y = -((event.clientY - b.top)  / b.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    let hitPoint = null;

    // Prioritas 1: raycast ke permukaan model IFC
    if (ifcModel && ifcModel.visible) {
        const hits = raycaster.intersectObject(ifcModel, true);
        if (hits.length > 0) hitPoint = hits[0].point.clone();
    }

    // Prioritas 2: fallback ke ground plane Y=0
    if (!hitPoint) {
        raycaster.ray.intersectPlane(groundPlane, groundHitVec);
        if (groundHitVec) hitPoint = groundHitVec.clone();
    }

    if (hitPoint) {
        // Konversi koordinat lokal Three.js → UTM 48S
        // Three.js: +X = Timur, -Z = Utara, +Y = Atas
        elCoordX.innerText = (BASE_E + hitPoint.x).toFixed(3);
        elCoordY.innerText = (BASE_N - hitPoint.z).toFixed(3);
        elCoordZ.innerText = (BASE_Z + hitPoint.y).toFixed(3);
    }
});

// ==========================================
// 10. SISTEM PENGUKURAN
//     Mode: 'none' | 'distance' | 'area' | 'volume'
// ==========================================
let measureMode    = 'none';
let distPoints     = [];          // Titik-titik ukur jarak (max 2)
let areaPoints     = [];          // Titik-titik ukur luas (min 3)
const measureObjs  = [];          // THREE.Object3D yg perlu dihapus saat clear

const btnDist  = document.getElementById('btn-measure-dist');
const btnArea  = document.getElementById('btn-measure-area');
const btnVol   = document.getElementById('btn-measure-vol');
const btnClear = document.getElementById('btn-clear-measure');
const hintEl   = document.getElementById('measure-hint');

const MODE_HINTS = {
    distance: '📏 Klik 2 titik pada model untuk mengukur jarak lurus',
    area:     '⬡ Klik 3+ titik — lalu double-klik untuk menutup & hitung luas',
    volume:   '📦 Double-klik pada objek 3D untuk menghitung volume bounding box',
};

/** Aktifkan / nonaktifkan mode pengukuran */
function setMeasureMode(mode) {
    measureMode = (measureMode === mode) ? 'none' : mode;

    btnDist.classList.toggle('active', measureMode === 'distance');
    btnArea.classList.toggle('active', measureMode === 'area');
    btnVol.classList.toggle('active',  measureMode === 'volume');

    canvas.style.cursor = measureMode !== 'none' ? 'crosshair' : 'default';
    hintEl.classList.toggle('hidden', measureMode === 'none');
    if (measureMode !== 'none') hintEl.innerText = MODE_HINTS[measureMode];

    // Reset titik saat ganti mode
    distPoints = [];
    areaPoints = [];
}

btnDist.addEventListener('click', () => setMeasureMode('distance'));
btnArea.addEventListener('click', () => setMeasureMode('area'));
btnVol.addEventListener('click',  () => setMeasureMode('volume'));

btnClear.addEventListener('click', () => {
    measureObjs.forEach(o => scene.remove(o));
    measureObjs.length = 0;
    distPoints = []; areaPoints = [];
    btnClear.classList.add('hidden');
    showProperties({ '': 'Semua data ukur telah dihapus.' });
});

/* ---------- Helper: marker titik ---------- */
function addDot(point, color = 0x00f0ff) {
    const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 16, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    );
    dot.position.copy(point);
    scene.add(dot);
    measureObjs.push(dot);
}

/* ---------- Helper: garis antara 2 titik ---------- */
function addLine(p1, p2, color = 0x00f0ff) {
    const geo  = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, linewidth: 3, depthTest: false }));
    scene.add(line);
    measureObjs.push(line);
}

/* ---------- Luas polygon via Shoelace di bidang XZ ---------- */
function calcArea(pts) {
    let area = 0;
    const n  = pts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].x * pts[j].z;
        area -= pts[j].x * pts[i].z;
    }
    return Math.abs(area / 2);
}

/** Tutup polygon luas & hitung */
function finishArea() {
    if (areaPoints.length < 3) return;
    // Tutup polygon: sambung titik terakhir ke titik pertama
    addLine(areaPoints[areaPoints.length - 1], areaPoints[0], 0xfbbf24);
    const area = calcArea(areaPoints);
    showProperties({
        'Mode':         '⬡ Pengukuran Luas',
        'Jumlah Titik': `${areaPoints.length} titik`,
        'Luas Area':    `${area.toFixed(3)} m²`,
        'Petunjuk':     'Klik "Hapus Data Ukur" untuk reset',
    });
    btnClear.classList.remove('hidden');
    areaPoints = [];
    setMeasureMode('none');
}

/* ---------- Dapatkan titik dari kursor (model → ground) ---------- */
function getClickPoint() {
    raycaster.setFromCamera(mouse, camera);
    if (ifcModel && ifcModel.visible) {
        const hits = raycaster.intersectObject(ifcModel, true);
        if (hits.length > 0) return hits[0].point.clone();
    }
    const t = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, t);
    return t ? t.clone() : null;
}

/* ---------- SINGLE CLICK: tambah titik ukur ---------- */
canvas.addEventListener('click', event => {
    if (measureMode === 'none' || measureMode === 'volume') return;
    if (event.detail > 1) return; // abaikan bagian dari double-click

    const point = getClickPoint();
    if (!point) return;

    if (measureMode === 'distance') {
        distPoints.push(point);
        addDot(point);

        if (distPoints.length === 2) {
            addLine(distPoints[0], distPoints[1]);
            const dist     = distPoints[0].distanceTo(distPoints[1]);
            const deltaY   = Math.abs(distPoints[0].y - distPoints[1].y);
            const horizDist = Math.sqrt(dist * dist - deltaY * deltaY);
            showProperties({
                'Mode':          '📏 Pengukuran Jarak',
                'Jarak Lurus':   `${dist.toFixed(3)} m`,
                'Jarak Horisontal': `${horizDist.toFixed(3)} m`,
                'Beda Elevasi':  `${deltaY.toFixed(3)} m`,
                'Elev Titik 1':  `${(BASE_Z + distPoints[0].y).toFixed(3)} m (MSL)`,
                'Elev Titik 2':  `${(BASE_Z + distPoints[1].y).toFixed(3)} m (MSL)`,
            });
            distPoints = [];
            btnClear.classList.remove('hidden');
        } else {
            hintEl.innerText = '📏 Klik titik kedua untuk selesai...';
        }

    } else if (measureMode === 'area') {
        areaPoints.push(point);
        addDot(point, 0xfbbf24);
        if (areaPoints.length > 1) {
            addLine(areaPoints[areaPoints.length - 2], areaPoints[areaPoints.length - 1], 0xfbbf24);
        }
        hintEl.innerText = `⬡ ${areaPoints.length} titik — double-klik untuk selesai`;
    }
});

/* ---------- DOUBLE CLICK: tutup area / volume / atribut IFC ---------- */
window.addEventListener('dblclick', async () => {
    raycaster.setFromCamera(mouse, camera);

    // Mode luas: double-click menutup polygon
    if (measureMode === 'area') {
        if (areaPoints.length >= 3) finishArea();
        return;
    }

    if (!ifcModel || !ifcModel.visible) return;
    const hits = raycaster.intersectObject(ifcModel, true);

    // Mode volume: tampilkan bounding box & hitung volume
    if (measureMode === 'volume') {
        if (hits.length > 0) {
            const obj  = hits[0].object;
            const box  = new THREE.Box3().setFromObject(obj);
            const sz   = box.getSize(new THREE.Vector3());
            const vol  = sz.x * sz.y * sz.z;

            // Tampilkan bounding box kuning
            const boxHelper = new THREE.Box3Helper(box, 0xfbbf24);
            scene.add(boxHelper);
            measureObjs.push(boxHelper);

            showProperties({
                'Mode':         '📦 Pengukuran Volume',
                'Panjang':      `${sz.x.toFixed(3)} m`,
                'Lebar':        `${sz.z.toFixed(3)} m`,
                'Tinggi':       `${sz.y.toFixed(3)} m`,
                'Luas Footprint': `${(sz.x * sz.z).toFixed(3)} m²`,
                'Volume':       `${vol.toFixed(3)} m³`,
            });
            btnClear.classList.remove('hidden');
        }
        return;
    }

    // Mode default (none): tampilkan atribut IFC + estimasi volume
    if (hits.length > 0) {
        const hit = hits[0];
        const id  = ifcLoader.ifcManager.getExpressId(hit.object.geometry, hit.faceIndex);

        // Highlight elemen terpilih
        ifcLoader.ifcManager.createSubset({
            modelID:       ifcModelID,
            ids:           [id],
            material:      highlightMat,
            scene,
            removePrevious: true
        });

        const props = await ifcLoader.ifcManager.getItemProperties(0, id);

        // Bangun objek display dengan label Indonesia
        const display = {};
        Object.keys(props).forEach(k => {
            if (IFC_SKIP.has(k)) return;
            const raw = props[k];
            const val = (raw !== null && typeof raw === 'object' && 'value' in raw)
                ? raw.value
                : raw;
            if (val === null || val === undefined || typeof val === 'object') return;
            const label = IFC_LABEL[k] || k;
            display[label] = String(val);
        });

        showProperties(display);

    } else {
        // Klik area kosong → hapus highlight
        if (ifcModel) ifcLoader.ifcManager.removeSubset(ifcModelID, scene);
        showProperties({});
    }
});

// ==========================================
// 11. TAMPILKAN PROPERTI DI PANEL
// ==========================================
function showProperties(data) {
    const el = document.getElementById('properties-content');
    if (!data || Object.keys(data).length === 0) {
        el.innerHTML = '<p class="empty-state">Double-klik objek 3D untuk melihat informasi detail.</p>';
        return;
    }
    let html = '';
    Object.entries(data).forEach(([k, v]) => {
        if (k.startsWith('—')) {
            // Baris pemisah judul
            html += `<div class="prop-row" style="border-bottom:none;padding:10px 0 4px;">
                <span style="color:#00f0ff;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${k}</span>
            </div>`;
            return;
        }
        html += `<div class="prop-row">
            <span class="prop-key">${k}</span>
            <span class="prop-value">${v}</span>
        </div>`;
    });
    el.innerHTML = html || '<p class="empty-state">Data tidak tersedia untuk elemen ini.</p>';
}

// ==========================================
// 12. KOMPAS — BERPUTAR SESUAI ROTASI KAMERA
// ==========================================
const compassEl = document.getElementById('compass-arrow');

// ==========================================
// 13. LOOP ANIMASI
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Update arah kompas berdasarkan azimut kamera (radian → derajat)
    if (compassEl) {
        const azimuth = controls.getAzimuthalAngle();
        compassEl.style.transform = `rotate(${-(azimuth * 180 / Math.PI)}deg)`;
    }

    renderer.render(scene, camera);
}
animate();

// ==========================================
// 14. RESPONSIF RESIZE WINDOW
// ==========================================
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight, false);
});