package device

import (
    "context"
    "regexp"
    "strings"
)

type Fingerprinter struct {
    Exec CommandExecutor
}

func NewFingerprinter(exec CommandExecutor) *Fingerprinter {
    return &Fingerprinter{Exec: exec}
}

type discoveryCmd struct {
    Command string
    Parse   func(string) *DeviceInfo
}

var discoveryCmds = map[DeviceVendor]discoveryCmd{
    VendorCisco:    {Command: "show version", Parse: parseCiscoShowVersion},
    VendorHuawei:   {Command: "display version", Parse: parseHuaweiShowVersion},
    VendorH3C:      {Command: "display version", Parse: parseHuaweiShowVersion},
    VendorJuniper:  {Command: "show version", Parse: parseJuniperShowVersion},
    VendorArista:   {Command: "show version", Parse: parseAristaShowVersion},
    VendorFortinet: {Command: "get system status", Parse: parseFortinetGetSystem},
    VendorLinux:    {Command: "uname -a", Parse: parseLinuxUname},
}

func (f *Fingerprinter) Run(ctx context.Context, vendor DeviceVendor) *DeviceInfo {
    dc, ok := discoveryCmds[vendor]
    if !ok || dc.Command == "" { return nil }
    output, err := f.Exec.Execute(ctx, dc.Command)
    if err != nil || output == "" { return nil }
    info := dc.Parse(output)
    if info == nil { return nil }
    info.Method = MethodActiveCmd
    info.RawOutput = output
    return info
}

func parseCiscoShowVersion(out string) *DeviceInfo {
    info := &DeviceInfo{Vendor: VendorCisco, Category: CatSwitch}
    reSerial := regexp.MustCompile("(?i)System serial number\\\\s*:\\\\s*(\\\\S+)")
    reVer := regexp.MustCompile("(?i)Version\\\\s+(\\\\S+[^,])")
    reOS := regexp.MustCompile("(?i)(NX-OS|IOS-XR|ASA)")
    for _, ln := range strings.Split(out, "\\\\n") {
        if info.Model == "" && strings.HasPrefix(ln, "Cisco IOS") {
            fields := strings.Fields(ln)
            if len(fields) > 3 { info.Model = fields[3] }
        }
        if m := reSerial.FindStringSubmatch(ln); len(m) > 1 {
            info.Serial = strings.TrimSpace(m[1])
        }
        if m := reVer.FindStringSubmatch(ln); len(m) > 1 {
            info.OSVersion = strings.TrimSpace(m[1])
        }
        if m := reOS.FindString(ln); m != "" {
            if m == "NX-OS" { info.OS = OSNXOS }
            if m == "IOS-XR" { info.OS = OSIOSXR }
            if m == "ASA" { info.OS = OSASA }
        }
    }
    if info.OS == "" { info.OS = OSIOS }
    info.Confidence = 95
    return info
}
func parseHuaweiShowVersion(out string) *DeviceInfo {
    info := &DeviceInfo{Vendor: VendorHuawei, OS: OSVRP, Category: CatSwitch}
    reModel := regexp.MustCompile("(?i)(Huawei|HUAWEI)\\\\s+(\\\\S+)")
    reVer := regexp.MustCompile("(?i)VRP.*Version\\\\s+(\\\\S+)")
    reSerial := regexp.MustCompile("(?i)Serial\\\\s*[Nn]umber\\\\s*:\\\\s*(\\\\S+)")
    for _, ln := range strings.Split(out, "\\\\n") {
        if m := reModel.FindStringSubmatch(ln); len(m) > 2 && m[2] != "" {
            info.Model = m[2]
        }
        if m := reVer.FindStringSubmatch(ln); len(m) > 1 {
            info.OSVersion = strings.TrimSpace(m[1])
        }
        if m := reSerial.FindStringSubmatch(ln); len(m) > 1 {
            info.Serial = m[1]
        }
    }
    info.Confidence = 90
    return info
}

func parseJuniperShowVersion(out string) *DeviceInfo {
    info := &DeviceInfo{Vendor: VendorJuniper, OS: OSJunOS, Category: CatRouter}
    reModel := regexp.MustCompile("(?i)Model:\\\\s+(\\\\S+)")
    reHost := regexp.MustCompile("(?i)Hostname:\\\\s+(\\\\S+)")
    if m := reModel.FindStringSubmatch(out); len(m) > 1 { info.Model = m[1] }
    if m := reHost.FindStringSubmatch(out); len(m) > 1 { info.Hostname = m[1] }
    info.Confidence = 90
    return info
}

func parseAristaShowVersion(out string) *DeviceInfo {
    info := &DeviceInfo{Vendor: VendorArista, OS: OSEOS, Category: CatSwitch}
    reModel := regexp.MustCompile("(?i)Arista\\\\s+(\\\\S+)")
    reVer := regexp.MustCompile("(?i)Version:\\\\s+(\\\\S+)")
    if m := reModel.FindStringSubmatch(out); len(m) > 1 { info.Model = m[1] }
    if m := reVer.FindStringSubmatch(out); len(m) > 1 { info.OSVersion = m[1] }
    info.Confidence = 90
    return info
}

func parseFortinetGetSystem(out string) *DeviceInfo {
    info := &DeviceInfo{Vendor: VendorFortinet, OS: OSFortiOS, Category: CatFirewall}
    reModel := regexp.MustCompile("(?i)Product name\\\\s*:\\\\s*(\\\\S+)")
    reVer := regexp.MustCompile("(?i)Firmware Version\\\\s*:\\\\s*(\\\\S+)")
    if m := reModel.FindStringSubmatch(out); len(m) > 1 { info.Model = m[1] }
    if m := reVer.FindStringSubmatch(out); len(m) > 1 { info.OSVersion = m[1] }
    info.Confidence = 90
    return info
}

func parseLinuxUname(out string) *DeviceInfo {
    info := &DeviceInfo{Vendor: VendorLinux, OS: OSLinux, Category: CatServer}
    re := regexp.MustCompile("^(\\\\S+)\\\\s+(\\\\S+)\\\\s+(\\\\S+)\\\\s+(\\\\S+)\\\\s+(\\\\S+)")
    if m := re.FindStringSubmatch(strings.TrimSpace(out)); len(m) > 5 {
        info.Hostname = m[2]
        info.OSVersion = m[3]
        info.Arch = m[5]
    }
    info.Confidence = 90
    return info
}
