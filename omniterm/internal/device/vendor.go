package device

import (
    "regexp"
    "strings"
)

type VendorDetector struct {
    Host      string
    Port      int
    User      string
    SSHBanner string
    Prompt    string
}

func (d *VendorDetector) Detect() (DeviceVendor, int) {
    if d.SSHBanner != "" {
        v, c := detectFromBanner(d.SSHBanner)
        if v != VendorUnknown {
            return v, c
        }
    }
    if d.Prompt != "" {
        v, c := detectFromPrompt(d.Prompt)
        if v != VendorUnknown {
            return v, c
        }
    }
    if d.Port > 0 {
        v, c := detectFromPort(d.Port); return v, c
    }
    return VendorUnknown, 0
}

func detectFromBanner(banner string) (DeviceVendor, int) {
    b := strings.ToLower(banner)
    switch {
    case strings.Contains(b, "cisco nx-os"):
        return VendorCisco, 90
    case strings.Contains(b, "cisco-"):
        return VendorCisco, 85
    case strings.Contains(b, "huawei"):
        return VendorHuawei, 85
    case strings.Contains(b, "junos"), strings.Contains(b, "juniper"):
        return VendorJuniper, 85
    case strings.Contains(b, "arista"):
        return VendorArista, 85
    case strings.Contains(b, "fortigate"):
        return VendorFortinet, 85
    case strings.Contains(b, "openssh_for_windows"):
        return VendorWindows, 80
    case strings.Contains(b, "openssh"):
        return VendorLinux, 60
    case strings.Contains(b, "dropbear"):
        return VendorLinux, 60
    }
    return VendorUnknown, 0
}

func detectFromPrompt(prompt string) (DeviceVendor, int) {
    p := strings.TrimSpace(prompt)
    if p == "" { return VendorUnknown, 0 }

    // Cisco: contains (config- and ends with #
    if strings.Contains(p, "(config") && strings.HasSuffix(p, "#") {
        return VendorCisco, 90
    }
    if strings.HasSuffix(p, ">") || strings.HasSuffix(p, "#") {
        if !strings.Contains(p, "@") && !strings.Contains(p, ":") {
            return VendorCisco, 70
        }
    }

    // Fortinet: starts with Forti
    if strings.HasPrefix(p, "Forti") || strings.HasPrefix(p, "FG") {
        return VendorFortinet, 85
    }

    // Juniper: has @ then > or #
    if strings.Contains(p, "@") && (strings.HasSuffix(p, ">") || strings.HasSuffix(p, "#")) {
        return VendorJuniper, 80
    }

    // Huawei/H3C: starts with < or [
    if strings.HasPrefix(p, "<") || strings.HasPrefix(p, "[") {
        pl := strings.ToLower(p)
        if strings.Contains(pl, "huawei") { return VendorHuawei, 90 }
        if strings.Contains(pl, "h3c") { return VendorH3C, 90 }
        if strings.Contains(pl, "zte") { return VendorZTE, 85 }
        if strings.Contains(pl, "quidway") { return VendorHuawei, 85 }
        return VendorHuawei, 60
    }

    // Linux: user@hostname:path$
    if strings.Contains(p, "@") && strings.Contains(p, ":") {
        if strings.HasSuffix(p, "$") || strings.HasSuffix(p, "#") {
            return VendorLinux, 75
        }
    }

    // Windows CMD: C:\\...>
    if matched, _ := regexp.MatchString("^[A-Za-z]:", p); matched && strings.HasSuffix(p, ">") {
        return VendorWindows, 85
    }
    // PowerShell: PS ...>
    if strings.HasPrefix(p, "PS ") && strings.HasSuffix(p, ">") {
        return VendorWindows, 85
    }

    // Arista
    if strings.HasPrefix(p, "localhost") && (strings.HasSuffix(p, ">") || strings.HasSuffix(p, "#")) {
        return VendorArista, 75
    }

    return VendorUnknown, 0
}

func detectFromPort(port int) (DeviceVendor, int) {
    switch port {
    case 23:  return VendorCisco, 30
    case 3389: return VendorWindows, 30
    case 5900, 5901: return VendorLinux, 20
    }
    return VendorUnknown, 0
}
