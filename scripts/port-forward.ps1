# PowerShell script to set up port forwarding from Windows to WSL
# Run this script as Administrator in PowerShell

param(
    [int]$Port = 5173,
    [switch]$Remove,
    [switch]$Show
)

if ($Show) {
    netsh interface portproxy show all
    exit
}

# Get WSL IP address
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]

if ($Remove) {
    Write-Host "Removing port forwarding for port $Port..."
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0
    netsh advfirewall firewall delete rule name="WSL Port $Port"
    Write-Host "Port forwarding removed."
} else {
    Write-Host "WSL IP: $wslIp"
    Write-Host "Setting up port forwarding for port $Port..."

    # Remove existing rule if any
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null

    # Add port forwarding
    netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=$wslIp

    # Add firewall rule
    netsh advfirewall firewall delete rule name="WSL Port $Port" 2>$null
    netsh advfirewall firewall add rule name="WSL Port $Port" dir=in action=allow protocol=TCP localport=$Port

    Write-Host ""
    Write-Host "Port forwarding set up successfully!"
    Write-Host "Access from other devices: http://<Windows-IP>:$Port"
    Write-Host ""
    Write-Host "Current port proxies:"
    netsh interface portproxy show all
    Write-Host ""
    Write-Host "To remove this forwarding:"
    Write-Host "  .\port-forward.ps1 -Remove"
}

Write-Host ""
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
