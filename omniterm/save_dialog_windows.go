//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Windows OPENFILENAMEW struct for GetSaveFileNameW
type openfilenameW struct {
	lStructSize       uint32
	hwndOwner         syscall.Handle
	hInstance         syscall.Handle
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	Flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        unsafe.Pointer
	dwReserved        uint32
	FlagsEx           uint32
}

const (
	OFN_HIDEREADONLY     = 0x4
	OFN_OVERWRITEPROMPT  = 0x2
	OFN_PATHMUSTEXIST    = 0x800
	OFN_DONTADDTORECENT  = 0x2000000
)

// winSaveFileDialog opens a native Windows "Save As" dialog.
// Returns the selected file path, or empty string if cancelled.
func winSaveFileDialog(title, defaultFilename, filter string, filterIndex uint32) (string, error) {
	comdlg32 := syscall.NewLazyDLL("comdlg32.dll")
	procGetSaveFileName := comdlg32.NewProc("GetSaveFileNameW")

	buf := make([]uint16, 260) // MAX_PATH
	copy(buf, syscall.StringToUTF16(defaultFilename))

	var ofn openfilenameW
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
	ofn.lpstrFile = &buf[0]
	ofn.nMaxFile = uint32(len(buf))
	ofn.Flags = OFN_HIDEREADONLY | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_DONTADDTORECENT

	if title != "" {
		t, _ := syscall.UTF16PtrFromString(title)
		ofn.lpstrTitle = t
	}
	if filter != "" {
		f, _ := syscall.UTF16PtrFromString(filter)
		ofn.lpstrFilter = f
	}
	ofn.nFilterIndex = filterIndex

	// Default extension if user doesn't type one
	defExt, _ := syscall.UTF16PtrFromString("txt")
	ofn.lpstrDefExt = defExt

	ret, _, callErr := procGetSaveFileName.Call(uintptr(unsafe.Pointer(&ofn)))
	if ret == 0 {
		// User cancelled or error
		if callErr != syscall.Errno(0) {
			return "", fmt.Errorf("save dialog error: %w", callErr)
		}
		return "", nil
	}

	return syscall.UTF16ToString(buf), nil
}
