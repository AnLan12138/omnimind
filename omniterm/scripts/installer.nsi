!include "MUI2.nsh"

Name "OmniMind"
OutFile "OmniMind-Setup.exe"
InstallDir "$PROGRAMFILES\OmniMind"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "..\build\bin\OmniMind.exe"
  CreateShortCut "$DESKTOP\OmniMind.lnk" "$INSTDIR\OmniMind.exe"
  CreateDirectory "$SMPROGRAMS\OmniMind"
  CreateShortCut "$SMPROGRAMS\OmniMind\OmniMind.lnk" "$INSTDIR\OmniMind.exe"
  CreateShortCut "$SMPROGRAMS\OmniMind\Uninstall.lnk" "$INSTDIR\uninstall.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\OmniMind.exe"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$DESKTOP\OmniMind.lnk"
  RMDir /r "$SMPROGRAMS\OmniMind"
  RMDir "$INSTDIR"
SectionEnd
