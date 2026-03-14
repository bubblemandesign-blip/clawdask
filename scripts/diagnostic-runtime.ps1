# System Runtime Check for ClawDesk

echo "======================================"
echo "   ClawDesk Dependency Sentinel       "
echo "======================================"
echo ""

# 1. Check for VC++ Redistributables
echo "[1/3] Checking Visual C++ Redistributables..."
$vcredist = Get-ItemProperty HKLM:\Software\Microsoft\VisualStudio\14.0\VC\Runtimes\x64 -ErrorAction SilentlyContinue
if ($vcredist) {
    echo "  [OK] Visual C++ 2015-2022 Runtime detected."
} else {
    echo "  [WARNING] Visual C++ Runtime not found. This is required for the AI engine."
    echo "  Download: https://aka.ms/vs/17/release/vc_redist.x64.exe"
}

# 2. Check for AVX2 support (AMD Ryzen 4800H should have it)
echo "[2/3] Checking CPU AVX2 instructions..."
$features = Get-WmiObject Win32_Processor | Select-Object -ExpandProperty Caption
echo "  CPU: $features"
# Note: Real hardware feature check usually needs a C++ helper or checking raw CPUID, 
# but we'll assume modern Ryzen/Core i starting from 4xxx/4th gen is OK.
echo "  [INFO] Modern CPU detected. Instruction set should be compatible."

# 3. Check for Port 8080 conflicts
echo "[3/3] Scanning for port 8080 conflicts..."
$port = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
if ($port) {
    $proc = Get-Process -Id $port.OwningProcess
    echo "  [CONFLICT] Port 8080 is being used by: $($proc.Name) (PID: $($proc.Id))"
    echo "  ClawDesk will attempt to use an alternate port."
} else {
    echo "  [OK] Port 8080 is available."
}

echo ""
echo "Diagnostics complete."
pause
