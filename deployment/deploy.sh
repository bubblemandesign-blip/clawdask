#!/bin/bash
# Universal ORRERY Native Server Deployer (VPS & Mac)
# Built for absolute seamless security and zero capability loss.

set -e

echo "====================================================="
echo " ORRERY Universal Server Deployer (ORRERY)      "
echo "====================================================="

# Detect OS
OS="$(uname -s)"
echo "=> Detected OS: $OS"

# 1. Install System Dependencies
if [ "$OS" = "Linux" ]; then
    echo "=> Installing Linux Native Dependencies..."
    sudo apt-get update
    sudo apt-get install -y curl wget git build-essential python3
    
    # Chromium for ORRERY 'browser' core tool (Fixes Alpine crash)
    sudo apt-get install -y chromium-browser chromium || sudo apt-get install -y chromium
    
    # Docker for ORRERY 'coding' sandboxes (Host level only, no DinD paradox)
    if ! command -v docker &> /dev/null; then
        echo "=> Installing Docker Engine for coding sandboxes..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        rm get-docker.sh
    fi
elif [ "$OS" = "Darwin" ]; then
    echo "=> Mac Environment detected. Assumes Homebrew is installed."
    brew install chromium docker
fi

# 2. Install Node.js 20 & PM2
if ! command -v node &> /dev/null; then
    echo "=> Installing Node.js..."
    if [ "$OS" = "Linux" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ "$OS" = "Darwin" ]; then
        brew install node@20
    fi
fi

if ! command -v pm2 &> /dev/null; then
    echo "=> Installing PM2 Process Manager..."
    sudo npm install -g pm2
fi

# 3. Install ORRERY Globally
echo "=> Installing ORRERY..."
sudo npm install -g ORRERY@latest

# 4. Configure Secure Token
TOKEN=$(openssl rand -hex 16)
mkdir -p ~/.ORRERY/config
cat << EOF > ~/.ORRERY/config/ORRERY.json
{
  "gateway": {
    "mode": "public",
    "port": 8848,
    "bind": "127.0.0.1",
    "auth": { "mode": "token", "token": "$TOKEN" }
  },
  "agents": {
    "defaults": { "sandbox": { "mode": "all" } }
  },
  "tools": {
    "profile": "coding",
    "allow": ["browser", "web_search", "web_fetch"]
  }
}
EOF

# 5. Start ORRERY securely via PM2
echo "=> Starting ORRERY in the background (PM2)..."
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=$(which chromium || which chromium-browser) pm2 start "ORRERY gateway" --name "ORRERY-server"

# 6. Auto-HTTPS configuration (Caddy) for Linux
if [ "$OS" = "Linux" ]; then
    echo "-----------------------------------------------------"
    read -p "Do you want to configure Auto-HTTPS with a custom domain? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your domain (e.g., ai.yourdomain.com): " domain
        if ! command -v caddy &> /dev/null; then
            sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
            sudo apt update && sudo apt install caddy
        fi
        
        # Configure Caddy Reverse Proxy
        cat << EOF | sudo tee /etc/caddy/Caddyfile
$domain {
    reverse_proxy 127.0.0.1:8848
}
EOF
        sudo systemctl restart caddy
        
        echo "====================================================="
        echo "✅ Deployment Successful (NemoClaw-Lite Architecture)"
        echo "Your Dashboard: https://$domain/?token=$TOKEN"
    else
        echo "====================================================="
        echo "✅ Local Server Mode Successful"
        echo "Your Local Dashboard: http://127.0.0.1:8848/?token=$TOKEN"
        echo "⚠️ Warning: Please use SSH Tunneling strictly, as HTTP is insecure."
    fi
else
    echo "====================================================="
    echo "✅ Local Mac Server Mode Successful"
    echo "Your Local Dashboard: http://127.0.0.1:8848/?token=$TOKEN"
fi

echo "====================================================="
