import os
import re
import time
import threading
import collections
import subprocess
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Global state
latest_responses = {}  # key: dongle_id, value: {"text": str, "timestamp": float, "log_time": str}
responses_lock = threading.Lock()
log_buffer = collections.deque(maxlen=100)
log_lock = threading.Lock()

# Parse helper for Asterisk CLI outputs
def parse_devices_output(output):
    lines = output.strip().split('\n')
    if not lines:
        return []
    header = lines[0]
    col_names = ["ID", "Group", "State", "RSSI", "Mode", "Submode", "Provider Name", "Model", "Firmware", "IMEI", "IMSI", "Number"]
    indices = []
    for name in col_names:
        idx = header.find(name)
        indices.append(idx)
    
    indices.append(len(header) + 100)
    
    devices = []
    for line in lines[1:]:
        if not line.strip() or line.startswith('-----') or 'ID' in line:
            continue
        row = {}
        for i in range(len(col_names)):
            start = indices[i]
            end = indices[i+1]
            val = line[start:end].strip()
            row[col_names[i]] = val
        if row.get("ID") and row["ID"].startswith("dongle"):
            devices.append(row)
    return devices

# Background thread to monitor Asterisk live logs locally
def monitor_asterisk_logs():
    print("Starting local Asterisk log monitor thread...")
    # Matches USSD response lines in /var/log/asterisk/full
    response_pattern = re.compile(
        r'\[([^\]]+)\] VERBOSE\[\d+\] at_response\.c:\s+\[([^\]]+)\] Got USSD type \d+ \'[^\']*\': \'(.*)\''
    )
    
    # Generic chan_dongle pattern for log streaming
    dongle_pattern = re.compile(r'chan_dongle|at_response|app_ussd|dongle\d+')
    
    log_file_path = '/var/log/asterisk/full'
    
    while True:
        try:
            if not os.path.exists(log_file_path):
                print(f"Log file {log_file_path} not found. Retrying in 5s...")
                time.sleep(5)
                continue
                
            print(f"Opening local log file: {log_file_path}")
            with open(log_file_path, 'r', encoding='utf-8', errors='replace') as f:
                # Seek to the end of the file to only process new logs
                f.seek(0, 2)
                
                while True:
                    line = f.readline()
                    if not line:
                        time.sleep(0.1) # Wait for new content
                        continue
                        
                    line_str = line.strip()
                    
                    # If it's a dongle-related log, append to dashboard logs
                    if dongle_pattern.search(line_str):
                        with log_lock:
                            log_buffer.append(line_str)
                    
                    # Check if it matches a USSD response
                    match = response_pattern.search(line_str)
                    if match:
                        log_time, dongle_id, text = match.groups()
                        print(f"Captured USSD response for {dongle_id} -> {text}")
                        with responses_lock:
                            latest_responses[dongle_id] = {
                                "text": text,
                                "timestamp": time.time(),
                                "log_time": log_time
                            }
        except Exception as e:
            err_msg = f"Log Monitor Local Error: {e}"
            print(err_msg)
            with log_lock:
                log_buffer.append(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] SYSTEM ERROR: {err_msg}")
            time.sleep(5)

# Validate USSD code to prevent shell injection
def validate_ussd_code(code):
    return bool(re.match(r'^[0-9*#+,]+$', code))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/devices', methods=['GET'])
def get_devices():
    try:
        # Run local command directly on server - compatible with Python 3.6
        res = subprocess.run(['asterisk', '-rx', 'dongle show devices'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout = res.stdout.decode('utf-8', errors='replace')
        stderr = res.stderr.decode('utf-8', errors='replace')
        if res.returncode != 0:
            return jsonify({"success": False, "error": f"Asterisk command failed: {stderr}"}), 500
        devices = parse_devices_output(stdout)
        return jsonify({"success": True, "devices": devices})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/send', methods=['POST'])
def send_ussd():
    data = request.json or {}
    dongle = data.get('dongle')
    code = data.get('code')
    
    if not dongle or not code:
        return jsonify({"success": False, "error": "Dongle and USSD code are required"}), 400
        
    if not validate_ussd_code(code):
        return jsonify({"success": False, "error": "Invalid USSD code format"}), 400
        
    # Clear previous response for this dongle
    with responses_lock:
        if dongle in latest_responses:
            del latest_responses[dongle]
            
    try:
        print(f"Sending USSD code '{code}' to {dongle}...")
        
        # Execute the USSD command locally on server - compatible with Python 3.6
        res = subprocess.run(['asterisk', '-rx', f'dongle ussd {dongle} {code}'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out = res.stdout.decode('utf-8', errors='replace')
        err = res.stderr.decode('utf-8', errors='replace')
        
        # Check command launch status
        if "Successfully sent" not in out and "queued" not in out and "Successfully" not in out:
            with log_lock:
                log_buffer.append(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] CLI: Sent command for {dongle}, output: {out.strip()}")
        
        # Wait for the response in background log monitor
        timeout = 15.0  # 15 seconds timeout
        start_wait = time.time()
        captured_response = None
        
        while time.time() - start_wait < timeout:
            with responses_lock:
                if dongle in latest_responses:
                    captured_response = latest_responses[dongle]
                    break
            time.sleep(0.2)
            
        if captured_response:
            return jsonify({
                "success": True,
                "response": captured_response["text"],
                "log_time": captured_response["log_time"]
            })
        else:
            return jsonify({
                "success": False,
                "error": "Timeout waiting for USSD response from the cellular network."
            }), 504
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/logs', methods=['GET'])
def get_logs():
    with log_lock:
        return jsonify({"success": True, "logs": list(log_buffer)})

if __name__ == '__main__':
    # Start the log monitor thread
    monitor_thread = threading.Thread(target=monitor_asterisk_logs, daemon=True)
    monitor_thread.start()
    
    # Run the server on port 3000
    app.run(host='0.0.0.0', port=3000, debug=False)
