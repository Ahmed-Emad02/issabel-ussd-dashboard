# GSM Dongle USSD Dashboard for Issabel 4 (Asterisk 11)

A lightweight web dashboard on port `3000` to select a GSM dongle, enter USSD codes, and see live network responses captured from Asterisk logs.

---

## 🚀 Easy Installation on Fresh Issabel 4 Server

Run the following commands as `root` on your new Issabel server:

### 1. Clone this repository
```bash
git clone https://github.com/Ahmed-Emad02/issabel-ussd-dashboard.git /opt/ussd-dashboard
cd /opt/ussd-dashboard
```

### 2. Install dependencies (Flask compatible with Python 3.6)
```bash
yum install -y python3 python3-pip
pip3 install "flask<2.1" "itsdangerous<2.1" "jinja2<3.1" "click<8.1" "markupsafe<2.1" "werkzeug<2.1"
```

### 3. Register and Start the System Service
```bash
cp ussd-dashboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable ussd-dashboard
systemctl start ussd-dashboard
```

### 4. Enable Firewall Port 3000
```bash
firewall-cmd --zone=public --add-port=3000/tcp --permanent
firewall-cmd --reload
```

---

## 📱 Accessing the Dashboard
Open your web browser and navigate to:
`http://<your-server-ip>:3000`
