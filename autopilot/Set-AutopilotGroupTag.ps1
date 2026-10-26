<#
.SYNOPSIS
    GUI for choosing an Autopilot GroupTag (department / afdeling) during OOBE or ESP.

.DESCRIPTION
    Shows a WinForms picker with the departments from GroupTags.json and writes the chosen
    GroupTag to the device's Windows Autopilot record through Microsoft Graph.

    Modes:
      Update   - The device is already registered in Autopilot (normal ESP case).
                 Looks the device up by serial number and sets its GroupTag.
      Register - The device is NOT registered yet (OOBE, Shift+F10). Uploads the hardware
                 hash with the chosen GroupTag, waits for the import to finish.
                 If the device already exists it falls back to Update.

    Authentication (no PowerShell modules required, works in OOBE):
      - App-only:  -TenantId -ClientId -ClientSecret  (app registration with the
                   application permission DeviceManagementServiceConfig.ReadWrite.All)
      - Delegated: leave -ClientSecret empty. A device code is shown in the GUI and a
                   technician signs in on another device/phone.

    Result is stored in HKLM:\SOFTWARE\AutopilotGroupTag (usable as Intune detection rule).

    Exit codes: 0 = success, 1 = error, 1602 = cancelled by user.

.EXAMPLE
    # ESP / already registered, technician signs in with device code
    powershell.exe -ExecutionPolicy Bypass -File .\Set-AutopilotGroupTag.ps1

.EXAMPLE
    # OOBE (Shift+F10), register the hash with app-only credentials
    powershell.exe -ExecutionPolicy Bypass -File .\Set-AutopilotGroupTag.ps1 -Mode Register `
        -TenantId contoso.onmicrosoft.com -ClientId <appId> -ClientSecret <secret>

.EXAMPLE
    # Unattended, no GUI
    .\Set-AutopilotGroupTag.ps1 -NoGui -GroupTag FIN
#>
[CmdletBinding()]
param(
    [ValidateSet('Update', 'Register')]
    [string]$Mode = 'Update',

    [string]$ConfigPath = (Join-Path $PSScriptRoot 'GroupTags.json'),

    [string]$TenantId = 'organizations',
    # Default = Microsoft Graph Command Line Tools (public client, used for device code sign-in)
    [string]$ClientId = '14d82eec-204b-4c2f-b7e8-296a70dab67e',
    [string]$ClientSecret,

    # Optional user to assign to the device when registering
    [string]$AssignedUser,

    # Skip the GUI and use this GroupTag directly
    [switch]$NoGui,
    [string]$GroupTag,

    [int]$TimeoutMinutes = 25,
    [string]$LogPath = (Join-Path $env:ProgramData 'AutopilotGroupTag\Set-AutopilotGroupTag.log')
)

$ErrorActionPreference = 'Stop'
$GraphBase = 'https://graph.microsoft.com/beta'
$RegPath = 'HKLM:\SOFTWARE\AutopilotGroupTag'
# Danish letters as char codes so the script file can stay plain ASCII (safe in PowerShell 5.1)
$ae = [char]0xE6; $aa = [char]0xE5

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

#region Logging
function Write-Log {
    param([string]$Message, [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try {
        $dir = Split-Path $LogPath -Parent
        if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch { }
}
#endregion

#region Config
function Get-DepartmentConfig {
    if (-not (Test-Path $ConfigPath)) { throw "Config file not found: $ConfigPath" }
    # -Encoding UTF8 so Danish letters (ae/oe/aa) survive in Windows PowerShell 5.1
    $config = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $config.Departments) { throw "No departments defined in $ConfigPath" }
    return $config
}
#endregion

#region Device info
function Get-DeviceSerial {
    (Get-CimInstance -ClassName Win32_BIOS).SerialNumber.Trim()
}

function Get-DeviceHardwareHash {
    $devDetail = Get-CimInstance -Namespace 'root/cimv2/mdm/dmmap' -ClassName 'MDM_DevDetail_Ext01' `
        -Filter "InstanceID='Ext' AND ParentID='./DevDetail'"
    if (-not $devDetail -or -not $devDetail.DeviceHardwareData) {
        throw 'Could not read the hardware hash (MDM_DevDetail_Ext01). Run as administrator/SYSTEM.'
    }
    return $devDetail.DeviceHardwareData
}
#endregion

#region GUI
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Show-GroupTagPicker {
    param($Config, [string]$Serial)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = if ($Config.Title) { $Config.Title } else { 'Select department' }
    $form.Size = New-Object System.Drawing.Size(460, 470)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.TopMost = $true
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

    $header = New-Object System.Windows.Forms.Label
    $header.Text = "V${ae}lg afdeling for denne computer"
    $header.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
    $header.Location = New-Object System.Drawing.Point(16, 14)
    $header.Size = New-Object System.Drawing.Size(420, 28)
    $form.Controls.Add($header)

    $info = New-Object System.Windows.Forms.Label
    $info.Text = "Computer: $env:COMPUTERNAME    Serienummer: $Serial"
    $info.ForeColor = [System.Drawing.Color]::DimGray
    $info.Location = New-Object System.Drawing.Point(18, 44)
    $info.Size = New-Object System.Drawing.Size(420, 22)
    $form.Controls.Add($info)

    $list = New-Object System.Windows.Forms.ListBox
    $list.Location = New-Object System.Drawing.Point(18, 72)
    $list.Size = New-Object System.Drawing.Size(408, 230)
    $list.Font = New-Object System.Drawing.Font('Segoe UI', 11)
    foreach ($dept in $Config.Departments) {
        [void]$list.Items.Add(('{0}   [{1}]' -f $dept.Name, $dept.GroupTag))
    }
    $form.Controls.Add($list)

    $desc = New-Object System.Windows.Forms.Label
    $desc.Location = New-Object System.Drawing.Point(18, 308)
    $desc.Size = New-Object System.Drawing.Size(408, 44)
    $desc.ForeColor = [System.Drawing.Color]::DimGray
    $form.Controls.Add($desc)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'OK'
    $ok.Enabled = $false
    $ok.Location = New-Object System.Drawing.Point(230, 370)
    $ok.Size = New-Object System.Drawing.Size(95, 34)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($ok)
    $form.AcceptButton = $ok

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Annuller'
    $cancel.Location = New-Object System.Drawing.Point(331, 370)
    $cancel.Size = New-Object System.Drawing.Size(95, 34)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancel)
    $form.CancelButton = $cancel

    $list.Add_SelectedIndexChanged({
        $ok.Enabled = $list.SelectedIndex -ge 0
        if ($list.SelectedIndex -ge 0) { $desc.Text = $Config.Departments[$list.SelectedIndex].Description }
    })
    $list.Add_DoubleClick({
        if ($list.SelectedIndex -ge 0) { $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() }
    })

    if ($Config.DefaultGroupTag) {
        for ($i = 0; $i -lt $Config.Departments.Count; $i++) {
            if ($Config.Departments[$i].GroupTag -eq $Config.DefaultGroupTag) { $list.SelectedIndex = $i }
        }
    }

    $form.Add_Shown({ $form.Activate(); $list.Focus() })
    $result = $form.ShowDialog()
    $selected = if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $list.SelectedIndex -ge 0) {
        $Config.Departments[$list.SelectedIndex]
    }
    $form.Dispose()
    return $selected
}

# Small non-modal status window so the user sees progress while Graph calls run
$script:StatusForm = $null
function Show-Status {
    param([string]$Text)
    Write-Log $Text
    if ($NoGui) { return }
    if (-not $script:StatusForm) {
        $f = New-Object System.Windows.Forms.Form
        $f.Text = 'Autopilot GroupTag'
        $f.Size = New-Object System.Drawing.Size(480, 220)
        $f.StartPosition = 'CenterScreen'
        $f.FormBorderStyle = 'FixedDialog'
        $f.ControlBox = $false
        $f.TopMost = $true
        $f.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        $lbl = New-Object System.Windows.Forms.Label
        $lbl.Name = 'StatusLabel'
        $lbl.Location = New-Object System.Drawing.Point(16, 16)
        $lbl.Size = New-Object System.Drawing.Size(440, 150)
        $f.Controls.Add($lbl)
        $f.Show()
        $script:StatusForm = $f
    }
    $script:StatusForm.Controls['StatusLabel'].Text = $Text
    [System.Windows.Forms.Application]::DoEvents()
}

function Close-Status {
    if ($script:StatusForm) { $script:StatusForm.Close(); $script:StatusForm.Dispose(); $script:StatusForm = $null }
}

# Sleep while keeping the status window responsive
function Wait-Responsive {
    param([int]$Seconds)
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        if ($script:StatusForm) { [System.Windows.Forms.Application]::DoEvents() }
        Start-Sleep -Milliseconds 250
    }
}

function Show-Message {
    param([string]$Text, [string]$Icon = 'Information')
    if ($NoGui) { return }
    [void][System.Windows.Forms.MessageBox]::Show($Text, 'Autopilot GroupTag', 'OK', $Icon)
}
#endregion

#region Authentication
function Get-OAuthError {
    param($ErrorRecord)
    try { return ($ErrorRecord.ErrorDetails.Message | ConvertFrom-Json) } catch { return $null }
}

function Get-GraphToken {
    $tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"

    if ($ClientSecret) {
        if ($TenantId -eq 'organizations') { throw 'App-only sign-in requires -TenantId.' }
        Show-Status 'Logger ind i Microsoft Graph (app)...'
        $body = @{
            client_id     = $ClientId
            client_secret = $ClientSecret
            scope         = 'https://graph.microsoft.com/.default'
            grant_type    = 'client_credentials'
        }
        return (Invoke-RestMethod -Method Post -Uri $tokenUrl -Body $body).access_token
    }

    # Delegated device code flow - technician signs in on another device
    $dc = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode" -Body @{
        client_id = $ClientId
        scope     = 'https://graph.microsoft.com/DeviceManagementServiceConfig.ReadWrite.All offline_access'
    }
    Show-Status ("Log ind som Intune-administrator:`r`n`r`n1. G${aa} til {0}`r`n2. Indtast koden:  {1}`r`n`r`nVenter p${aa} login..." -f $dc.verification_uri, $dc.user_code)
    Write-Log $dc.message

    $interval = [int]$dc.interval
    $deadline = (Get-Date).AddSeconds([int]$dc.expires_in)
    while ((Get-Date) -lt $deadline) {
        Wait-Responsive -Seconds $interval
        try {
            $token = Invoke-RestMethod -Method Post -Uri $tokenUrl -Body @{
                client_id   = $ClientId
                grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
                device_code = $dc.device_code
            }
            return $token.access_token
        } catch {
            $err = Get-OAuthError $_
            switch ($err.error) {
                'authorization_pending' { continue }
                'slow_down'             { $interval += 5; continue }
                default                 { throw "Sign-in failed: $($err.error_description)" }
            }
        }
    }
    throw 'Sign-in timed out.'
}
#endregion

#region Graph
function Invoke-Graph {
    param([string]$Method = 'GET', [string]$Uri, $Body)
    $headers = @{ Authorization = "Bearer $script:Token" }
    $params = @{ Method = $Method; Uri = $Uri; Headers = $headers; ContentType = 'application/json' }
    if ($null -ne $Body) { $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10)) }

    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            return Invoke-RestMethod @params
        } catch {
            $status = $null
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            if ($attempt -lt 5 -and ($status -eq 429 -or $status -ge 500)) {
                Write-Log "Graph returned $status, retrying ($attempt)..." 'WARN'
                Wait-Responsive -Seconds (5 * $attempt)
                continue
            }
            $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            throw "Graph $Method $Uri failed: $detail"
        }
    }
}

function Get-AutopilotDevice {
    param([string]$Serial)
    $filter = [uri]::EscapeDataString("contains(serialNumber,'$Serial')")
    $result = Invoke-Graph -Uri "$GraphBase/deviceManagement/windowsAutopilotDeviceIdentities?`$filter=$filter"
    # contains() can match partial serials, keep the exact one
    return $result.value | Where-Object { $_.serialNumber -eq $Serial } | Select-Object -First 1
}

function Set-AutopilotGroupTagValue {
    param($Device, [string]$Tag)
    if ($Device.groupTag -eq $Tag) {
        Write-Log "GroupTag is already '$Tag' - nothing to change."
        return
    }
    Show-Status "S${ae}tter GroupTag '$Tag' (tidligere: '$($Device.groupTag)')..."
    Invoke-Graph -Method POST -Uri "$GraphBase/deviceManagement/windowsAutopilotDeviceIdentities/$($Device.id)/updateDeviceProperties" `
        -Body @{ groupTag = $Tag } | Out-Null
}

function Register-AutopilotDevice {
    param([string]$Serial, [string]$Tag)
    Show-Status "L${ae}ser hardware hash..."
    $hash = Get-DeviceHardwareHash

    Show-Status "Uploader hardware hash med GroupTag '$Tag'..."
    $import = Invoke-Graph -Method POST -Uri "$GraphBase/deviceManagement/importedWindowsAutopilotDeviceIdentities" -Body @{
        '@odata.type'             = '#microsoft.graph.importedWindowsAutopilotDeviceIdentity'
        groupTag                  = $Tag
        serialNumber              = $Serial
        productKey                = ''
        hardwareIdentifier        = $hash
        assignedUserPrincipalName = $(if ($AssignedUser) { $AssignedUser } else { '' })
        state                     = @{
            '@odata.type'          = 'microsoft.graph.importedWindowsAutopilotDeviceIdentityState'
            deviceImportStatus     = 'pending'
            deviceRegistrationId   = ''
            deviceErrorCode        = 0
            deviceErrorName        = ''
        }
    }

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    while ($true) {
        if ((Get-Date) -gt $deadline) { throw 'Timed out waiting for the Autopilot import.' }
        Wait-Responsive -Seconds 15
        $state = (Invoke-Graph -Uri "$GraphBase/deviceManagement/importedWindowsAutopilotDeviceIdentities/$($import.id)").state
        Show-Status "Import status: $($state.deviceImportStatus)..."
        if ($state.deviceImportStatus -eq 'complete') { break }
        if ($state.deviceImportStatus -eq 'error') {
            throw "Import failed: $($state.deviceErrorName) ($($state.deviceErrorCode))"
        }
    }

    # Clean up the import record, the device identity stays
    try { Invoke-Graph -Method DELETE -Uri "$GraphBase/deviceManagement/importedWindowsAutopilotDeviceIdentities/$($import.id)" | Out-Null } catch { }

    Show-Status "Venter p${aa} at enheden synkroniseres til Autopilot..."
    while (-not ($device = Get-AutopilotDevice -Serial $Serial)) {
        if ((Get-Date) -gt $deadline) { throw 'Timed out waiting for the device to appear in Autopilot.' }
        Wait-Responsive -Seconds 15
    }
    return $device
}
#endregion

#region Main
try {
    Write-Log "===== Start (Mode=$Mode, User=$env:USERNAME) ====="
    $config = Get-DepartmentConfig
    $serial = Get-DeviceSerial
    Write-Log "Serial number: $serial"

    if ($NoGui -or $GroupTag) {
        if (-not $GroupTag) { throw '-NoGui requires -GroupTag.' }
        $dept = $config.Departments | Where-Object { $_.GroupTag -eq $GroupTag } | Select-Object -First 1
        if (-not $dept) { Write-Log "GroupTag '$GroupTag' is not in the config - using it anyway." 'WARN' }
        $tag = $GroupTag
    } else {
        $dept = Show-GroupTagPicker -Config $config -Serial $serial
        if (-not $dept) {
            Write-Log 'Cancelled by user.' 'WARN'
            exit 1602
        }
        $tag = $dept.GroupTag
    }
    Write-Log "Selected GroupTag: $tag"

    $script:Token = Get-GraphToken

    Show-Status 'Finder enheden i Autopilot...'
    $device = Get-AutopilotDevice -Serial $serial

    if ($device) {
        Set-AutopilotGroupTagValue -Device $device -Tag $tag
    } elseif ($Mode -eq 'Register') {
        $device = Register-AutopilotDevice -Serial $serial -Tag $tag
    } else {
        throw "Device with serial '$serial' was not found in Autopilot. Use -Mode Register to upload the hash."
    }

    if (-not (Test-Path $RegPath)) { New-Item -Path $RegPath -Force | Out-Null }
    Set-ItemProperty -Path $RegPath -Name 'GroupTag' -Value $tag
    Set-ItemProperty -Path $RegPath -Name 'SetOn' -Value (Get-Date -Format 's')

    Close-Status
    Write-Log "Done. GroupTag '$tag' set on Autopilot device $($device.id)."
    Show-Message "GroupTag '$tag' er sat for denne computer."
    exit 0
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    Close-Status
    Show-Message "Fejl:`r`n$($_.Exception.Message)`r`n`r`nLog: $LogPath" 'Error'
    exit 1
}
#endregion
