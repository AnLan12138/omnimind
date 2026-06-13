package device

import (
    "context"
    "fmt"
    "strings"
)

type DeviceVendor string

const (
    VendorCisco DeviceVendor = "cisco"
    VendorHuawei DeviceVendor = "huawei"
    VendorH3C DeviceVendor = "h3c"
    VendorJuniper DeviceVendor = "juniper"
    VendorArista DeviceVendor = "arista"
    VendorFortinet DeviceVendor = "fortinet"
    VendorZTE DeviceVendor = "zte"
    VendorRuijie DeviceVendor = "ruijie"
    VendorLinux DeviceVendor = "linux"
    VendorWindows DeviceVendor = "windows"
    VendorMacOS DeviceVendor = "macos"
    VendorESXi DeviceVendor = "vmware-esxi"
    VendorBSD DeviceVendor = "bsd"
    VendorPaloAlto DeviceVendor = "palo-alto"
    VendorUnknown DeviceVendor = "unknown"
)

func (v DeviceVendor) String() string { return string(v) }

type DeviceCategory string

const (
    CatSwitch DeviceCategory = "switch"
    CatRouter DeviceCategory = "router"
    CatFirewall DeviceCategory = "firewall"
    CatServer DeviceCategory = "server"
    CatWorkstation DeviceCategory = "workstation"
    CatHypervisor DeviceCategory = "hypervisor"
    CatLoadBalancer DeviceCategory = "load-balancer"
    CatAccessPoint DeviceCategory = "access-point"
    CatSwitchRouter DeviceCategory = "switch-router"
    CatUnknown DeviceCategory = "unknown"
)

type DeviceOS string

const (
    OSIOS DeviceOS = "ios"
    OSNXOS DeviceOS = "nx-os"
    OSIOSXR DeviceOS = "ios-xr"
    OSASA DeviceOS = "asa"
    OSVRP DeviceOS = "vrp"
    OSComware DeviceOS = "comware"
    OSJunOS DeviceOS = "junos"
    OSEOS DeviceOS = "eos"
    OSFortiOS DeviceOS = "fortios"
    OSPanOS DeviceOS = "panos"
    OSLinux DeviceOS = "linux"
    OSWindows DeviceOS = "windows"
    OSMacOS DeviceOS = "macos"
    OSESXi DeviceOS = "esxi"
    OSFreeBSD DeviceOS = "freebsd"
    OSUnknown DeviceOS = "unknown"
)

func (o DeviceOS) String() string { return string(o) }

type DetectMethod string

const (
    MethodUserSpecified DetectMethod = "user-specified"
    MethodSSHBanner     DetectMethod = "ssh-banner"
    MethodPrompt        DetectMethod = "prompt-pattern"
    MethodPort          DetectMethod = "port-heuristic"
    MethodActiveCmd     DetectMethod = "active-command"
)

type DeviceInfo struct {
    Vendor     DeviceVendor   `json:"vendor"`
    Category   DeviceCategory `json:"category"`
    OS         DeviceOS       `json:"os"`
    OSVersion  string         `json:"osVersion"`
    Model      string         `json:"model"`
    Serial     string         `json:"serial"`
    Hostname   string         `json:"hostname"`
    Arch       string         `json:"arch"`
    Confidence int            `json:"confidence"`
    Method     DetectMethod   `json:"method"`
    RawOutput  string         `json:"-"`
}

func (d *DeviceInfo) Summary() string {
    if d.Vendor == VendorUnknown {
        return "unknown device"
    }
    v := string(d.Vendor)
    if d.Model != "" {
        if d.OSVersion != "" {
            return fmt.Sprint(v, " ", d.Model, " (v", d.OSVersion, ")")
        }
        return fmt.Sprint(v, " ", d.Model)
    }
    if d.OSVersion != "" {
        return fmt.Sprint(v, " (v", d.OSVersion, ")")
    }
    return string(d.Vendor)
}

func (d *DeviceInfo) AIContext() string {
    var b strings.Builder
    b.WriteString(fmt.Sprint("Vendor: ", d.Vendor, "\\n"))
    b.WriteString(fmt.Sprint("Category: ", d.Category, "\\n"))
    b.WriteString(fmt.Sprint("OS: ", d.OS, "\\n"))
    if d.OSVersion != "" {
        b.WriteString(fmt.Sprint("OSVersion: ", d.OSVersion, "\\n"))
    }
    if d.Model != "" {
        b.WriteString(fmt.Sprint("Model: ", d.Model, "\\n"))
    }
    if d.Serial != "" {
        b.WriteString(fmt.Sprint("Serial: ", d.Serial, "\\n"))
    }
    if d.Arch != "" {
        b.WriteString(fmt.Sprint("Arch: ", d.Arch, "\\n"))
    }
    return strings.TrimSpace(b.String())
}

type CommandExecutor interface {
    Execute(ctx context.Context, cmd string) (string, error)
}
