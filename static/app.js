// Global State
let devices = [];
let selectedDeviceId = null;
let isSending = false;

// DOM Elements
const serverStatusDot = document.getElementById('server-status-dot');
const serverStatusText = document.getElementById('server-status-text');
const devicesContainer = document.getElementById('devices-list-container');
const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
const selectedDongleBadge = document.getElementById('selected-dongle-badge');
const deviceDetailCard = document.getElementById('device-detail-card');
const noSelectionPlaceholder = document.getElementById('no-selection-placeholder');
const ussdForm = document.getElementById('ussd-form');
const ussdCodeInput = document.getElementById('ussd-code-input');
const sendBtn = document.getElementById('send-btn');
const terminalContainer = document.getElementById('terminal-response-container');
const terminalScreen = document.getElementById('terminal-screen-content');
const logScreen = document.getElementById('log-screen-content');
const autoscrollCheckbox = document.getElementById('autoscroll-checkbox');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Toggle Slider Elements
const logsToggle = document.getElementById('logs-toggle');
const autoscrollLabel = document.getElementById('autoscroll-label');

// Theme Toggle Elements
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = document.getElementById('theme-icon');

/* ----------------------------------------------------
   Device Status & Parsing Helpers
------------------------------------------------------- */

// Get CSS Class for Device State Badge
function getStateClass(state) {
    const s = state.toLowerCase();
    if (s.includes('free')) return 'free';
    if (s.includes('busy') || s.includes('dial') || s.includes('ring')) return 'busy';
    return 'not-connected';
}

// Generate Signal Bars HTML based on RSSI value
function getSignalBarsHTML(rssiStr, state) {
    const rssi = parseInt(rssiStr, 10);
    const s = state.toLowerCase();
    
    let activeBars = 0;
    if (s.includes('free') || s.includes('busy')) {
        if (rssi >= 20 && rssi <= 31) activeBars = 4;
        else if (rssi >= 15) activeBars = 3;
        else if (rssi >= 10) activeBars = 2;
        else if (rssi > 0) activeBars = 1;
    }
    
    let html = `<div class="signal-bars" title="Signal strength: ${rssiStr}/31">`;
    for (let i = 1; i <= 4; i++) {
        const fillClass = i <= activeBars ? 'fill' : '';
        html += `<span class="sig-bar ${fillClass}"></span>`;
    }
    html += `</div>`;
    return html;
}

/* ----------------------------------------------------
   API Requests
------------------------------------------------------- */

// Fetch GSM Dongles from Asterisk
async function fetchDevices() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();
        
        if (data.success) {
            devices = data.devices;
            renderDevices();
            
            // Update server connection status to healthy
            serverStatusDot.className = 'pulse-dot active';
            serverStatusText.textContent = 'Connected to Asterisk';
        } else {
            throw new Error(data.error || 'Unknown error fetching devices');
        }
    } catch (error) {
        console.error('Error loading devices:', error);
        devicesContainer.innerHTML = `
            <div class="empty-state-container">
                <div class="empty-state-icon">⚠️</div>
                <h3 style="color: var(--error-color)">Connection Failed</h3>
                <p>Could not load devices from Asterisk server. ${error.message}</p>
            </div>
        `;
        serverStatusDot.className = 'pulse-dot error';
        serverStatusText.textContent = 'Server Unreachable';
    }
}

// Render Devices inside the Left Panel List
function renderDevices() {
    if (devices.length === 0) {
        devicesContainer.innerHTML = `
            <div class="empty-state-container">
                <div class="empty-state-icon">📭</div>
                <h3>No Dongles Found</h3>
                <p>No active GSM dongles detected by chan_dongle module.</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    devices.forEach(dev => {
        const isSelected = dev.ID === selectedDeviceId;
        const stateClass = getStateClass(dev.State);
        const signalHTML = getSignalBarsHTML(dev.RSSI, dev.State);
        const phoneNum = dev.Number && dev.Number.toLowerCase() !== 'unknown' ? dev.Number : 'No Phone Number';
        
        html += `
            <div class="device-card ${isSelected ? 'selected' : ''}" data-id="${dev.ID}">
                <div class="device-card-header">
                    <span class="device-id">${dev.ID}</span>
                    <span class="device-badge-status ${stateClass}">${dev.State}</span>
                </div>
                <div class="device-card-body">
                    <div class="device-info-row">
                        <span>SIM Number:</span>
                        <span class="val number">${phoneNum}</span>
                    </div>
                    <div class="device-info-row">
                        <span>Network:</span>
                        <span class="val">${dev["Provider Name"] || 'Unknown'}</span>
                    </div>
                    <div class="device-info-row">
                        <span>Signal:</span>
                        <div class="signal-indicator">
                            <span class="val">${dev.RSSI}/31</span>
                            ${signalHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    devicesContainer.innerHTML = html;
    
    // Bind click listeners to card items
    const cards = devicesContainer.querySelectorAll('.device-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            selectDevice(card.getAttribute('data-id'));
        });
    });
}

// Select a GSM Dongle to focus
function selectDevice(id) {
    selectedDeviceId = id;
    
    // Refresh list UI selections
    const cards = devicesContainer.querySelectorAll('.device-card');
    cards.forEach(card => {
        if (card.getAttribute('data-id') === id) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    
    // Find device metadata
    const dev = devices.find(d => d.ID === id);
    if (!dev) return;
    
    // Update Request Panel
    selectedDongleBadge.textContent = dev.ID;
    selectedDongleBadge.className = 'selection-badge active';
    
    // Load minimal device details (Dongle ID, Number, Provider, IMEI)
    document.getElementById('detail-dongle-id').textContent = dev.ID;
    document.getElementById('detail-number').textContent = dev.Number && dev.Number.toLowerCase() !== 'unknown' ? dev.Number : 'Unknown';
    document.getElementById('detail-provider').textContent = dev["Provider Name"] || 'Unknown';
    document.getElementById('detail-imei').textContent = dev.IMEI || '-';
    
    // Show forms and detail panels
    deviceDetailCard.classList.remove('hidden');
    ussdForm.classList.remove('hidden');
    noSelectionPlaceholder.classList.add('hidden');
    
    // Focus USSD Input
    ussdCodeInput.focus();
}

// Send USSD code API
async function sendUSSDRequest(e) {
    e.preventDefault();
    
    if (isSending || !selectedDeviceId) return;
    
    const code = ussdCodeInput.value.trim();
    if (!code) return;
    
    isSending = true;
    
    // Set UI Loading State
    sendBtn.disabled = true;
    sendBtn.querySelector('.btn-text').textContent = 'Sending request...';
    sendBtn.querySelector('.btn-loader').classList.remove('hidden');
    ussdCodeInput.disabled = true;
    
    // Reset Terminal screen
    terminalContainer.classList.remove('hidden');
    terminalScreen.innerHTML = `
        <div class="terminal-line command">&gt; asterisk -rx "dongle ussd ${selectedDeviceId} ${code}"</div>
        <div class="terminal-line result" id="terminal-wait-msg">Sending USSD request to cellular network...</div>
    `;
    
    try {
        const response = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dongle: selectedDeviceId, code: code })
        });
        
        const data = await response.json();
        
        // Remove waiting msg
        const waitMsg = document.getElementById('terminal-wait-msg');
        if (waitMsg) waitMsg.remove();
        
        if (data.success) {
            terminalScreen.innerHTML += `
                <div class="terminal-line success-msg">[${data.log_time}] USSD RESPONSE RECEIVED:</div>
                <div class="terminal-line result" style="color: #00f5d4; font-weight: 500;">${data.response}</div>
            `;
        } else {
            terminalScreen.innerHTML += `
                <div class="terminal-line error-msg">Error: ${data.error || 'Request Failed.'}</div>
            `;
        }
    } catch (error) {
        console.error('Error sending USSD:', error);
        const waitMsg = document.getElementById('terminal-wait-msg');
        if (waitMsg) waitMsg.remove();
        
        terminalScreen.innerHTML += `
            <div class="terminal-line error-msg">Network Link Failure: ${error.message}</div>
        `;
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.querySelector('.btn-text').textContent = 'Execute USSD Request';
        sendBtn.querySelector('.btn-loader').classList.add('hidden');
        ussdCodeInput.disabled = false;
        
        // Scroll terminal to view
        terminalScreen.scrollTop = terminalScreen.scrollHeight;
        
        // Refresh devices status in background
        fetchDevices();
    }
}

// Fetch Asterisk chan_dongle logs from buffer
async function fetchLogs() {
    // Only query logs if the live log slider is turned on
    if (!logsToggle.checked) return;
    
    try {
        const response = await fetch('/api/logs');
        const data = await response.json();
        
        if (data.success && data.logs) {
            renderLogs(data.logs);
        }
    } catch (error) {
        console.error('Error fetching logs:', error);
    }
}

// Render log lines
function renderLogs(logs) {
    if (logs.length === 0) {
        logScreen.innerHTML = '<div class="log-line system-line">[System] Listening for live logs...</div>';
        return;
    }
    
    let html = '';
    logs.forEach(log => {
        let logClass = 'device-line';
        if (log.toLowerCase().includes('error') || log.toLowerCase().includes('unable to open')) {
            logClass = 'error-line';
        } else if (log.toLowerCase().includes('successfully') || log.toLowerCase().includes('got ussd')) {
            logClass = 'success-line';
        } else if (log.toLowerCase().includes('system') || log.toLowerCase().includes('connecting')) {
            logClass = 'system-line';
        } else if (log.toLowerCase().includes('cli:')) {
            logClass = 'info-line';
        }
        
        html += `<div class="log-line ${logClass}">${escapeHTML(log)}</div>`;
    });
    
    logScreen.innerHTML = html;
    
    // Auto-scroll logic
    if (autoscrollCheckbox.checked) {
        logScreen.scrollTop = logScreen.scrollHeight;
    }
}

// Helper to escape HTML tags
function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Update Theme Toggler Icon SVG
function updateThemeIcon(theme) {
    if (theme === 'light') {
        themeIcon.innerHTML = `
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        `;
    } else {
        themeIcon.innerHTML = `
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        `;
    }
}

/* ----------------------------------------------------
   Setup and Event Listeners
------------------------------------------------------- */

// Initialize app
function init() {
    // Initialize Theme
    const currentTheme = localStorage.getItem('theme') || 'dark';
    document.body.className = `${currentTheme}-theme`;
    updateThemeIcon(currentTheme);
    
    fetchDevices();
    
    // Setup background polling intervals
    setInterval(fetchLogs, 2000);       // Poll logs every 2 seconds
    setInterval(fetchDevices, 10000);   // Poll devices every 10 seconds
    
    // Theme toggler click listener
    themeToggleBtn.addEventListener('click', () => {
        let activeTheme = 'dark';
        if (document.body.classList.contains('dark-theme')) {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            activeTheme = 'light';
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            activeTheme = 'dark';
        }
        localStorage.setItem('theme', activeTheme);
        updateThemeIcon(activeTheme);
    });
    
    // Wire logs toggle slider
    logsToggle.addEventListener('change', () => {
        if (logsToggle.checked) {
            logScreen.classList.remove('collapsed');
            autoscrollLabel.classList.remove('hidden');
            clearLogsBtn.classList.remove('hidden');
            // Fetch logs immediately
            fetchLogs();
        } else {
            logScreen.classList.add('collapsed');
            autoscrollLabel.classList.add('hidden');
            clearLogsBtn.classList.add('hidden');
        }
    });
    
    // Bind Event Listeners
    refreshDevicesBtn.addEventListener('click', () => {
        const svg = refreshDevicesBtn.querySelector('svg');
        svg.style.transition = 'transform 0.8s ease';
        svg.style.transform = 'rotate(360deg)';
        setTimeout(() => { svg.style.transform = 'none'; svg.style.transition = 'none'; }, 800);
        
        fetchDevices();
    });
    
    clearLogsBtn.addEventListener('click', () => {
        logScreen.innerHTML = '<div class="log-line system-line">[System] Console log cleared.</div>';
    });
    
    ussdForm.addEventListener('submit', sendUSSDRequest);
}

// Run init on DOM Content Loaded
document.addEventListener('DOMContentLoaded', init);
