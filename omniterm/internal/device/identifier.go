package device

import "context"

type Identifier struct {
    Detector      VendorDetector
    Fingerprinter *Fingerprinter
    DeviceInfo    DeviceInfo
    LastPrompt    string
    ModeDetector  *ModeDetector
    AutoFingerprint bool
}

func NewIdentifier(exec CommandExecutor, autoFingerprint bool) *Identifier {
    return &Identifier{
        Fingerprinter: NewFingerprinter(exec),
        AutoFingerprint: autoFingerprint,
    }
}

func (idn *Identifier) IdentifyPassive() DeviceInfo {
    vendor, confidence := idn.Detector.Detect()
    info := DeviceInfo{Vendor: vendor, Confidence: confidence}
    if idn.Detector.SSHBanner != "" {
        info.Method = MethodSSHBanner
    } else if idn.Detector.Prompt != "" {
        info.Method = MethodPrompt
    } else {
        info.Method = MethodPort
    }
    switch vendor {
    case VendorCisco:
        info.Category = CatSwitch
        info.OS = OSIOS
    case VendorHuawei:
        info.Category = CatSwitch
        info.OS = OSVRP
    case VendorH3C:
        info.Category = CatSwitch
        info.OS = OSComware
    case VendorJuniper:
        info.Category = CatRouter
        info.OS = OSJunOS
    case VendorArista:
        info.Category = CatSwitch
        info.OS = OSEOS
    case VendorFortinet:
        info.Category = CatFirewall
        info.OS = OSFortiOS
    case VendorLinux:
        info.Category = CatServer
        info.OS = OSLinux
    case VendorWindows:
        info.Category = CatWorkstation
        info.OS = OSWindows
    }
    idn.DeviceInfo = info
    return info
}

func (idn *Identifier) IdentifyDeep(ctx context.Context, skipSame string) (DeviceInfo, error) {
    idn.IdentifyPassive()
    if skipSame != "" && idn.DeviceInfo.Summary() == skipSame {
        return idn.DeviceInfo, nil
    }
    if idn.DeviceInfo.Vendor == VendorUnknown || !shouldAttemptDeep(idn.DeviceInfo.Vendor) {
        return idn.DeviceInfo, nil
    }
    deep := idn.Fingerprinter.Run(ctx, idn.DeviceInfo.Vendor)
    if deep != nil {
        if deep.Confidence < idn.DeviceInfo.Confidence {
            deep.Confidence = idn.DeviceInfo.Confidence
        }
        idn.DeviceInfo = *deep
    }
    return idn.DeviceInfo, nil
}

func shouldAttemptDeep(v DeviceVendor) bool {
    switch v {
    case VendorCisco, VendorHuawei, VendorH3C, VendorJuniper, VendorArista, VendorFortinet, VendorLinux:
        return true
    }
    return false
}

func (idn *Identifier) UpdatePrompt(prompt string) bool {
    idn.LastPrompt = prompt
    if idn.ModeDetector != nil {
        return idn.ModeDetector.Update(prompt)
    }
    return false
}

func (idn *Identifier) ContextString() string {
    if idn.DeviceInfo.Vendor == VendorUnknown {
        return ""
    }
    return idn.DeviceInfo.AIContext()
}