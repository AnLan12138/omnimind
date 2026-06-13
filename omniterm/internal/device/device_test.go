package device

import "testing"

func TestDetectFromBanner(t *testing.T) {
    tests := []struct {
        banner string
        want   DeviceVendor
    }{
        {"SSH-2.0-Cisco-1.25", VendorCisco},
        {"SSH-2.0-Cisco-NX-OS", VendorCisco},
        {"SSH-2.0-Huawei", VendorHuawei},
        {"SSH-2.0-JunOS", VendorJuniper},
        {"SSH-2.0-Arista", VendorArista},
        {"SSH-2.0-FortiGate", VendorFortinet},
        {"SSH-2.0-OpenSSH_for_Windows_8.1", VendorWindows},
        {"SSH-2.0-OpenSSH_8.9p1 Ubuntu-3", VendorLinux},
        {"SSH-2.0-dropbear_2022.83", VendorLinux},
    }
    for _, tt := range tests {
        v, _ := detectFromBanner(tt.banner)
        if v != tt.want {
            t.Errorf("detectFromBanner: got %v, want %v", v, tt.want)
        }
    }
}

func TestDetectFromPrompt(t *testing.T) {
    tests := []struct {
        prompt string
        want   DeviceVendor
    }{
        {"Switch>", VendorCisco},
        {"Router#", VendorCisco},
        {"Switch(config)#", VendorCisco},
        {"Router(config-if)#", VendorCisco},
        {"FortiGate-100D #", VendorFortinet},
        {"user@router>", VendorJuniper},
        {"admin@switch#", VendorJuniper},
        {"<Huawei>", VendorHuawei},
        {"[Huawei]", VendorHuawei},
        {"[Huawei-GigabitEthernet0/0/1]", VendorHuawei},
        {"<H3C>", VendorH3C},
        {"[H3C]", VendorH3C},
        {"<ZTE>", VendorZTE},
        {"root@server:~#", VendorLinux},
        {"user@host:/home/user$", VendorLinux},
        {"localhost>", VendorArista},
        {"localhost#", VendorArista},
    }
    for _, tt := range tests {
        v, _ := detectFromPrompt(tt.prompt)
        if v != tt.want {
            t.Errorf("prompt %s: got %v, want %v", tt.prompt, v, tt.want)
        }
    }
}

func TestPromptWindows(t *testing.T) {
    v, _ := detectFromPrompt("C:\\Users\\Admin>")
    if v != VendorWindows {
        t.Errorf("CMD prompt: got %v, want Windows", v)
    }
    v, _ = detectFromPrompt("PS C:\\Users\\Admin>")
    if v != VendorWindows {
        t.Errorf("PowerShell prompt: got %v, want Windows", v)
    }
}

func TestPortDetection(t *testing.T) {
    v, _ := detectFromPort(23)
    if v != VendorCisco {
        t.Errorf("port 23: got %v, want Cisco", v)
    }
    v, _ = detectFromPort(3389)
    if v != VendorWindows {
        t.Errorf("port 3389: got %v, want Windows", v)
    }
}

func TestCiscoModes(t *testing.T) {
    d := NewModeDetector(VendorCisco)
    if d.Detect("Switch>") != ModeUserMode { t.Error("expected user mode") }
    if d.Detect("Router#") != ModePrivileged { t.Error("expected priv mode") }
    if d.Detect("S(config)#") != ModeGlobalConfig { t.Error("expected global config") }
    if d.Detect("S(config-if)#") != ModeInterfaceConfig { t.Error("expected interface config") }
}

func TestModeSafety(t *testing.T) {
    if ModeUserMode.IsEditMode() { t.Error("user mode is not edit") }
    if !ModeGlobalConfig.IsEditMode() { t.Error("global config is edit") }
    if ModePrivileged.IsSafeForExec() != true { t.Error("priv mode safe for exec") }
    if ModeGlobalConfig.IsSafeForExec() != false { t.Error("config mode not safe") }
}

func TestDeviceSummary(t *testing.T) {
    d := &DeviceInfo{Vendor: VendorCisco, Model: "2960X", OSVersion: "15.2"}
    s := d.Summary()
    if s != "cisco 2960X (v15.2)" {
        t.Errorf("got %s", s)
    }
    d2 := &DeviceInfo{Vendor: VendorLinux}
    if d2.Summary() != "linux" { t.Errorf("got %s", d2.Summary()) }
}

func TestAIContext(t *testing.T) {
    d := &DeviceInfo{Vendor: VendorHuawei, Model: "S5735", OS: OSVRP}
    ctx := d.AIContext()
    if ctx == "" { t.Error("context should not be empty") }
}

func TestVendorDetector(t *testing.T) {
    d := &VendorDetector{SSHBanner: "SSH-2.0-Huawei", Port: 22}
    v, c := d.Detect()
    if v != VendorHuawei { t.Error("expected Huawei") }
    if c < 80 { t.Error("confidence too low") }
}
