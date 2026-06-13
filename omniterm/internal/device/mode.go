package device

import (
    "strings"
)

type CliMode string

const (
    ModeUserMode        CliMode = "user"
    ModePrivileged      CliMode = "privileged"
    ModeGlobalConfig    CliMode = "global-config"
    ModeInterfaceConfig CliMode = "interface-config"
    ModeRouterConfig    CliMode = "router-config"
    ModeVlanConfig      CliMode = "vlan-config"
    ModeLineConfig      CliMode = "line-config"
    ModeSystemView      CliMode = "system-view"
    ModeInterfaceView   CliMode = "interface-view"
    ModeConfigUnknown   CliMode = "config-unknown"
    ModeUnknown         CliMode = "unknown"
)

func (m CliMode) String() string { return string(m) }

func (m CliMode) IsEditMode() bool {
    switch m {
    case ModeGlobalConfig, ModeInterfaceConfig, ModeRouterConfig,
        ModeVlanConfig, ModeLineConfig, ModeSystemView,
        ModeInterfaceView, ModeConfigUnknown:
        return true
    }
    return false
}

func (m CliMode) IsSafeForExec() bool {
    return !m.IsEditMode()
}

// ModeDetector tracks CLI modes based on prompt patterns.
type ModeDetector struct {
    Vendor DeviceVendor
    Mode   CliMode
}

func NewModeDetector(vendor DeviceVendor) *ModeDetector {
    return &ModeDetector{Vendor: vendor}
}

func (d *ModeDetector) Detect(prompt string) CliMode {
    p := strings.TrimSpace(prompt)
    if p == "" { return ModeUnknown }
    switch d.Vendor {
    case VendorCisco:
        return detectCiscoMode(p)
    case VendorHuawei, VendorH3C:
        return detectHuaweiMode(p)
    case VendorJuniper:
        return detectJuniperMode(p)
    case VendorFortinet:
        return detectFortinetMode(p)
    case VendorLinux:
        return detectLinuxMode(p)
    }
    return ModeUnknown
}

func (d *ModeDetector) Update(prompt string) bool {
    old := d.Mode
    d.Mode = d.Detect(prompt)
    return old != d.Mode
}

func detectCiscoMode(p string) CliMode {
    switch {
    case strings.Contains(p, "(config-if)#"):
        return ModeInterfaceConfig
    case strings.Contains(p, "(config-vlan)#"):
        return ModeVlanConfig
    case strings.Contains(p, "(config-line)#"):
        return ModeLineConfig
    case strings.Contains(p, "(config-router)#"):
        return ModeRouterConfig
    case strings.Contains(p, "(config)#"):
        return ModeGlobalConfig
    case strings.HasSuffix(p, "#"):
        return ModePrivileged
    case strings.HasSuffix(p, ">"):
        return ModeUserMode
    }
    return ModeUnknown
}

func detectHuaweiMode(p string) CliMode {
    switch {
    case strings.HasSuffix(p, ">"):
        return ModeUserMode
    case strings.HasPrefix(p, "[") && strings.HasSuffix(p, "]"):
        _, after, found := strings.Cut(strings.TrimPrefix(p, "["), "-")
        if found && strings.Contains(after, "-") || strings.HasSuffix(after, "]") {
            return ModeInterfaceView
        }
        return ModeSystemView
    }
    return ModeUnknown
}

func detectJuniperMode(p string) CliMode {
    switch {
    case strings.HasSuffix(p, "#"):
        if strings.Contains(p, "configure") || strings.Contains(p, "conf") {
            return ModeGlobalConfig
        }
        return ModePrivileged
    case strings.HasSuffix(p, ">"):
        return ModeUserMode
    }
    return ModeUnknown
}

func detectFortinetMode(p string) CliMode {
    switch {
    case strings.Contains(p, "(config)"):
        return ModeGlobalConfig
    case strings.HasSuffix(p, "#"):
        return ModePrivileged
    }
    return ModeUnknown
}

func detectLinuxMode(p string) CliMode {
    switch {
    case strings.HasSuffix(p, "#"):
        return ModePrivileged
    case strings.HasSuffix(p, "$"):
        return ModeUserMode
    }
    return ModeUnknown
}
