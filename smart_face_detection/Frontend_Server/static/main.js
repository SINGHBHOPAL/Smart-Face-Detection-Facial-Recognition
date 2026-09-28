// State variables
let localStream = null;
let detectionInterval = null;
let isStreaming = false;
let systemStats = { totalScans: 0, registeredFaces: 0, matchRate: '0%' };
const FRAME_RATE = 10; // Process 10 frames per second

// DOM Elements
const tabButtons = document.querySelectorAll('.nav-menu .nav-btn');
const tabContents = document.querySelectorAll('.tab-content');
const toastContainer = document.getElementById('toast-container');

// Camera elements
const webcam = document.getElementById('webcam');
const cameraOverlay = document.getElementById('camera-overlay');
const startCameraBtn = document.getElementById('start-camera-btn');
const stopCameraBtn = document.getElementById('stop-camera-btn');
const viewportPlaceholder = document.getElementById('viewport-placeholder');
const scanningLaser = document.getElementById('scanning-laser');
const liveFaceCount = document.getElementById('live-face-count');
const liveActiveNames = document.getElementById('live-active-names');

// Registration Form Elements
const quickRegisterForm = document.getElementById('quick-register-form');
const quickNameInput = document.getElementById('quick-name');
const quickRegisterBtn = document.getElementById('quick-register-btn');
const dbRegisterForm = document.getElementById('db-register-form');
const dbNameInput = document.getElementById('db-name');
const dbImageInput = document.getElementById('db-image');
const dbUploadInner = document.getElementById('db-upload-inner');
const dbPreview = document.getElementById('db-preview');
const facesGallery = document.getElementById('faces-gallery');
const gallerySearch = document.getElementById('gallery-search');

// Scanner Elements
const dropzone = document.getElementById('dropzone');
const imageInput = document.getElementById('image-input');
const dropzonePrompt = document.getElementById('dropzone-prompt');
const scannerPreviewContainer = document.getElementById('scanner-preview-container');
const scannerPreviewImg = document.getElementById('scanner-preview-img');
const scannerOverlay = document.getElementById('scanner-overlay');
const scannerResults = document.getElementById('scanner-results');
const resetScannerBtn = document.getElementById('reset-scanner-btn');

// Stats Elements
const statTotalScans = document.getElementById('stat-total-scans');
const statRegisteredFaces = document.getElementById('stat-registered-faces');
const statMatchRate = document.getElementById('stat-match-rate');
const logsTableBody = document.getElementById('logs-table-body');
const logsEmptyState = document.getElementById('logs-empty-state');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Modal Elements
const imageModal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-img');
const modalCaption = document.getElementById('modal-caption');
const closeModalBtn = document.getElementById('close-modal-btn');

// Toast notifications
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ---------------- TAB NAVIGATION ----------------
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const tabId = `${btn.dataset.tab}-tab`;
        document.getElementById(tabId).classList.add('active');
        
        // Trigger specific tab loads
        if (btn.dataset.tab === 'database') {
            loadRegisteredFaces();
        } else if (btn.dataset.tab === 'analytics') {
            loadLogsAndStats();
        }
    });
});

// ---------------- WEBCAM MANAGEMENT ----------------
async function startWebcam() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false
        });
        webcam.srcObject = localStream;
        webcam.style.display = 'block';
        viewportPlaceholder.style.display = 'none';
        scanningLaser.classList.add('active');
        
        isStreaming = true;
        startCameraBtn.disabled = true;
        stopCameraBtn.disabled = false;
        quickRegisterBtn.disabled = false;
        
        showToast('Webcam feed activated successfully.', 'success');
        
        // Wait for video metadata to load to set up canvas properly
        webcam.onloadedmetadata = () => {
            cameraOverlay.width = webcam.videoWidth;
            cameraOverlay.height = webcam.videoHeight;
            startProcessingLoop();
        };
    } catch (err) {
        console.error("Webcam error:", err);
        showToast('Could not access webcam. Please check permissions.', 'danger');
        document.getElementById('system-status-text').textContent = 'Error';
        document.getElementById('system-status-text').parentElement.previousElementSibling.className = 'status-indicator offline';
    }
}

function stopWebcam() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    clearInterval(detectionInterval);
    
    webcam.srcObject = null;
    webcam.style.display = 'none';
    viewportPlaceholder.style.display = 'flex';
    scanningLaser.classList.remove('active');
    
    // Clear canvas
    const ctx = cameraOverlay.getContext('2d');
    ctx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
    
    isStreaming = false;
    startCameraBtn.disabled = false;
    stopCameraBtn.disabled = true;
    quickRegisterBtn.disabled = true;
    
    liveFaceCount.textContent = '0';
    liveActiveNames.textContent = 'None';
    
    showToast('Webcam feed stopped.', 'success');
}

startCameraBtn.addEventListener('click', startWebcam);
stopCameraBtn.addEventListener('click', stopWebcam);

// ---------------- PROCESSING LOOP ----------------
function startProcessingLoop() {
    const hiddenCanvas = document.createElement('canvas');
    hiddenCanvas.width = webcam.videoWidth;
    hiddenCanvas.height = webcam.videoHeight;
    const hiddenCtx = hiddenCanvas.getContext('2d');
    
    detectionInterval = setInterval(async () => {
        if (!isStreaming) return;
        
        // Draw video frame to hidden canvas
        hiddenCtx.drawImage(webcam, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
        
        // Convert to blob and send to backend
        hiddenCanvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('image', blob, 'frame.jpg');
            
            try {
                const response = await fetch('/api/detect', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                if (data.success) {
                    drawOverlay(data.results);
                    updateLiveMetrics(data.results);
                }
            } catch (err) {
                console.error("Frame processing error:", err);
            }
        }, 'image/jpeg', 0.6); // Compress slightly for network speed
    }, 1000 / FRAME_RATE);
}

function drawOverlay(results) {
    const ctx = cameraOverlay.getContext('2d');
    ctx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
    
    results.forEach(face => {
        const [x, y, w, h] = face.box;
        
        // Draw bounding box
        ctx.strokeStyle = face.name === 'Unknown' ? '#ff5b5b' : '#00ff88';
        ctx.lineWidth = 3;
        ctx.shadowColor = face.name === 'Unknown' ? 'rgba(255, 91, 91, 0.4)' : 'rgba(0, 255, 136, 0.4)';
        ctx.shadowBlur = 8;
        ctx.strokeRect(x, y, w, h);
        
        // Draw HUD corner details
        const cornerLen = Math.min(w, h) * 0.15;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 0;
        
        // Top-left
        ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
        // Top-right
        ctx.beginPath(); ctx.moveTo(x + w, y + cornerLen); ctx.lineTo(x + w, y); ctx.lineTo(x + w - cornerLen, y); ctx.stroke();
        // Bottom-left
        ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
        // Bottom-right
        ctx.beginPath(); ctx.moveTo(x + w, y + h - cornerLen); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerLen, y + h); ctx.stroke();
        
        // Draw Label tag background
        ctx.fillStyle = face.name === 'Unknown' ? 'rgba(255, 91, 91, 0.85)' : 'rgba(0, 255, 136, 0.85)';
        ctx.shadowBlur = 4;
        
        const labelText = `${face.name} (${face.confidence}%)`;
        ctx.font = 'bold 12px "Outfit", sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        
        ctx.fillRect(x, y - 25, textWidth + 14, 20);
        
        // Draw Label Text
        ctx.fillStyle = face.name === 'Unknown' ? '#ffffff' : '#0a0c14';
        ctx.shadowBlur = 0;
        ctx.fillText(labelText, x + 7, y - 11);
    });
}

function updateLiveMetrics(results) {
    liveFaceCount.textContent = results.length;
    const names = results.filter(f => f.name !== 'Unknown').map(f => f.name);
    liveActiveNames.textContent = names.length > 0 ? names.join(', ') : 'None';
}

// ---------------- QUICK REGISTER FACE ----------------
quickRegisterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isStreaming) return;
    
    const name = quickNameInput.value.trim();
    if (!name) return;
    
    // Snap frame from video
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = webcam.videoWidth;
    snapCanvas.height = webcam.videoHeight;
    const snapCtx = snapCanvas.getContext('2d');
    snapCtx.drawImage(webcam, 0, 0, snapCanvas.width, snapCanvas.height);
    
    snapCanvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('image', blob, 'registered_face.jpg');
        
        try {
            quickRegisterBtn.disabled = true;
            quickRegisterBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';
            
            const response = await fetch('/api/register', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            if (data.success) {
                showToast(`Successfully registered ${name} and trained model!`, 'success');
                quickNameInput.value = '';
                updateHeaderStats();
            } else {
                showToast(data.message || 'Registration failed.', 'danger');
            }
        } catch (err) {
            console.error(err);
            showToast('Network error during face registration.', 'danger');
        } finally {
            quickRegisterBtn.disabled = false;
            quickRegisterBtn.innerHTML = '<i class="fa-solid fa-plus-circle"></i> Snap & Register';
        }
    }, 'image/jpeg', 0.9);
});

// ---------------- IMAGE SCANNER TAB ----------------
// Trigger browse file
dropzone.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        processUploadedImage(e.target.files[0]);
    }
});

// Drag & Drop
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        processUploadedImage(e.dataTransfer.files[0]);
    }
});

function processUploadedImage(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        scannerPreviewImg.src = e.target.result;
        
        // When image loads, compute exact dimensions and overlay size
        scannerPreviewImg.onload = function() {
            dropzonePrompt.style.display = 'none';
            scannerPreviewContainer.style.display = 'block';
            resetScannerBtn.style.display = 'inline-flex';
            
            // Adjust canvas sizing
            scannerOverlay.width = scannerPreviewImg.naturalWidth;
            scannerOverlay.height = scannerPreviewImg.naturalHeight;
            
            // Trigger API scanner
            scanImageFile(file);
        };
    };
    reader.readAsDataURL(file);
}

async function scanImageFile(file) {
    const formData = new FormData();
    formData.append('image', file);
    
    scannerResults.innerHTML = `
        <div class="empty-state">
            <i class="fa-solid fa-circle-notch fa-spin placeholder-icon"></i>
            <p>Scanning details...</p>
            <span>Analyzing facial topology and mapping reference models</span>
        </div>
    `;
    
    try {
        const response = await fetch('/api/detect', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            drawScannerOverlay(data.results);
            renderScannerResults(data.results);
            updateHeaderStats();
        } else {
            showToast(data.message || 'Scan failed.', 'danger');
        }
    } catch (err) {
        console.error(err);
        showToast('Error sending image for detection.', 'danger');
    }
}

function drawScannerOverlay(results) {
    const ctx = scannerOverlay.getContext('2d');
    ctx.clearRect(0, 0, scannerOverlay.width, scannerOverlay.height);
    
    results.forEach(face => {
        const [x, y, w, h] = face.box;
        ctx.strokeStyle = face.name === 'Unknown' ? '#ff5b5b' : '#00ff88';
        ctx.lineWidth = 6; // Bigger line since scanned image resolution might be high
        ctx.strokeRect(x, y, w, h);
        
        ctx.fillStyle = face.name === 'Unknown' ? 'rgba(255, 91, 91, 0.9)' : 'rgba(0, 255, 136, 0.9)';
        ctx.font = 'bold 24px "Outfit", sans-serif';
        const text = `${face.name} (${face.confidence}%)`;
        ctx.fillRect(x, y - 40, ctx.measureText(text).width + 20, 35);
        
        ctx.fillStyle = '#000000';
        ctx.fillText(text, x + 10, y - 15);
    });
}

function renderScannerResults(results) {
    if (results.length === 0) {
        scannerResults.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-question placeholder-icon"></i>
                <p>No faces found</p>
                <span>Try an image with clear lighting and forward-facing profiles</span>
            </div>
        `;
        return;
    }
    
    let html = `
        <div class="metric-row">
            <span class="metric-label">Detected Faces</span>
            <span class="metric-value badge">${results.length}</span>
        </div>
        <div class="divider"></div>
        <div class="results-list">
    `;
    
    results.forEach((face, index) => {
        html += `
            <div class="result-item">
                <div class="result-left">
                    <span class="badge" style="background-color: var(--primary)">#${index+1}</span>
                    <span class="result-name ml-2">${face.name}</span>
                </div>
                <span class="result-conf">${face.confidence}% Match</span>
            </div>
        `;
    });
    
    html += `</div>`;
    scannerResults.innerHTML = html;
}

resetScannerBtn.addEventListener('click', () => {
    imageInput.value = '';
    dropzonePrompt.style.display = 'flex';
    scannerPreviewContainer.style.display = 'none';
    resetScannerBtn.style.display = 'none';
    
    scannerResults.innerHTML = `
        <div class="empty-state">
            <i class="fa-solid fa-image placeholder-icon"></i>
            <p>No image scanned yet</p>
            <span>Upload an image to trigger automated visual audit</span>
        </div>
    `;
    const ctx = scannerOverlay.getContext('2d');
    ctx.clearRect(0, 0, scannerOverlay.width, scannerOverlay.height);
});

// ---------------- DATABASE MANAGEMENT TAB ----------------
// Upload portrait preview helper
dbUploadInner.addEventListener('click', () => dbImageInput.click());

dbImageInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = function(ev) {
            dbPreview.src = ev.target.result;
            dbPreview.style.display = 'block';
            dbUploadInner.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
});

// Save to DB form submission
dbRegisterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = dbNameInput.value.trim();
    const file = dbImageInput.files[0];
    
    if (!name || !file) {
        showToast('Please fill out all fields.', 'danger');
        return;
    }
    
    const formData = new FormData();
    formData.append('name', name);
    formData.append('image', file);
    
    try {
        const btn = document.getElementById('db-register-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        
        const response = await fetch('/api/register', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(`Successfully registered ${name} and trained model!`, 'success');
            dbRegisterForm.reset();
            dbPreview.style.display = 'none';
            dbUploadInner.style.display = 'flex';
            loadRegisteredFaces();
            updateHeaderStats();
        } else {
            showToast(data.message || 'Registration failed.', 'danger');
        }
    } catch (err) {
        console.error(err);
        showToast('Error registering identity.', 'danger');
    } finally {
        const btn = document.getElementById('db-register-btn');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save to Database';
    }
});

// Load registered faces gallery
async function loadRegisteredFaces() {
    try {
        const response = await fetch('/api/faces');
        const data = await response.json();
        
        if (data.success) {
            renderGallery(data.faces);
        }
    } catch (err) {
        console.error("Error loading faces:", err);
    }
}

function renderGallery(faces) {
    if (faces.length === 0) {
        facesGallery.innerHTML = `
            <div class="empty-gallery">
                <i class="fa-solid fa-users-slash placeholder-icon"></i>
                <p>No identities registered</p>
                <span>Register a new face to enable smart recognition</span>
            </div>
        `;
        return;
    }
    
    let html = '';
    faces.forEach(face => {
        // Safe filepath replacement for static assets
        const imageSrc = face.image_path.replace(/\\/g, '/');
        
        html += `
            <div class="face-card" data-name="${face.name.toLowerCase()}">
                <div class="face-thumb-container">
                    <img class="face-thumb" src="/${imageSrc}" alt="${face.name}">
                </div>
                <div class="face-info">
                    <span class="face-name" title="${face.name}">${face.name}</span>
                    <button class="delete-face-btn" onclick="deleteFace(${face.id}, '${face.name}')">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </div>
            </div>
        `;
    });
    facesGallery.innerHTML = html;
}

// Global scope delete face helper (referenced in HTML strings)
window.deleteFace = async function(id, name) {
    if (!confirm(`Are you sure you want to delete registration for ${name}?`)) return;
    
    try {
        const response = await fetch(`/api/faces?id=${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(`Deleted ${name} registration.`, 'success');
            loadRegisteredFaces();
            updateHeaderStats();
        } else {
            showToast(data.message || 'Deletion failed.', 'danger');
        }
    } catch (err) {
        console.error(err);
        showToast('Network error deleting face.', 'danger');
    }
};

// Search filter in gallery
gallerySearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const cards = facesGallery.querySelectorAll('.face-card');
    
    cards.forEach(card => {
        const name = card.dataset.name;
        if (name.includes(query)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
});

// ---------------- LOGS & ANALYTICS TAB ----------------
async function loadLogsAndStats() {
    try {
        const statsRes = await fetch('/api/stats');
        const statsData = await statsRes.json();
        if (statsData.success) {
            updateDashboardCharts(statsData.stats.daily_activity || {});
        }
        
        const logsRes = await fetch('/api/logs');
        const logsData = await logsRes.json();
        if (logsData.success) {
            renderLogsTable(logsData.logs);
        }
    } catch (err) {
        console.error("Error fetching logs/stats:", err);
    }
}

function renderLogsTable(logs) {
    if (logs.length === 0) {
        logsTableBody.innerHTML = '';
        logsEmptyState.style.display = 'flex';
        return;
    }
    
    logsEmptyState.style.display = 'none';
    let html = '';
    
    logs.forEach(log => {
        const date = new Date(log.timestamp);
        const formattedDate = date.toLocaleString();
        
        const namesString = log.detected_names.length > 0 
            ? log.detected_names.map(name => `<span class="badge ${name === 'Unknown' ? 'badge-danger' : 'badge-success'}">${name}</span>`).join(' ')
            : '<span class="text-muted">None</span>';
            
        const imageCol = log.image_path 
            ? `<img class="log-thumbnail" src="/${log.image_path.replace(/\\/g, '/')}" onclick="openModal('/${log.image_path.replace(/\\/g, '/')}', '${formattedDate}')" alt="Capture">`
            : '<span class="text-muted">No Image</span>';
            
        html += `
            <tr>
                <td>${formattedDate}</td>
                <td><strong style="font-size: 1rem">${log.face_count}</strong></td>
                <td>${namesString}</td>
                <td>${imageCol}</td>
            </tr>
        `;
    });
    
    logsTableBody.innerHTML = html;
}

function updateDashboardCharts(dailyStats) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const container = document.getElementById('bar-chart-container');
    
    // Map database dynamic stats or fallback to dummy placeholders
    let maxScans = 1;
    days.forEach(day => {
        maxScans = Math.max(maxScans, dailyStats[day] || 0);
    });
    
    let html = '';
    days.forEach(day => {
        const value = dailyStats[day] || 0;
        // Percentage calculations
        const pct = maxScans > 0 ? (value / maxScans) * 85 + 10 : 10; // offset slightly for nice visual
        html += `
            <div class="bar-col">
                <div class="bar-fill" style="height: ${pct}%" title="${value} scans"></div>
                <span class="bar-lbl">${day}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

clearLogsBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear all history detection logs?')) return;
    
    try {
        const response = await fetch('/api/logs', {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showToast('Logs cleared.', 'success');
            loadLogsAndStats();
            updateHeaderStats();
        }
    } catch (err) {
        console.error(err);
        showToast('Error clearing logs.', 'danger');
    }
});

// ---------------- HEADER STATS REFRESH ----------------
async function updateHeaderStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        if (data.success) {
            statTotalScans.textContent = data.stats.total_scans;
            statRegisteredFaces.textContent = data.stats.registered_faces;
            statMatchRate.textContent = `${data.stats.match_rate}%`;
        }
    } catch (err) {
        console.error("Error refreshing stats:", err);
    }
}

// ---------------- IMAGE MODAL PREVIEW ----------------
window.openModal = function(src, caption) {
    imageModal.classList.add('active');
    modalImg.src = src;
    modalCaption.textContent = caption;
};

closeModalBtn.addEventListener('click', () => {
    imageModal.classList.remove('active');
});

imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) {
        imageModal.classList.remove('active');
    }
});

// ---------------- INITIALIZATION ----------------
window.addEventListener('DOMContentLoaded', () => {
    updateHeaderStats();
});
