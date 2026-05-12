!include "MUI2.nsh"

Name "OmniTerm"
OutFile "OmniTerm-Setup.exe"
InstallDir "$PROGRAMFILES\OmniTerm"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "..\build\bin\omniterm.exe"
  CreateShortCut "$DESKTOP\OmniTerm.lnk" "$INSTDIR\omniterm.exe"
  CreateDirectory "$SMPROGRAMS\OmniTerm"
  CreateShortCut "$SMPROGRAMS\OmniTerm\OmniTerm.lnk" "$INSTDIR\omniterm.exe"
  CreateShortCut "$SMPROGRAMS\OmniTerm\Uninstall.lnk" "$INSTDIR\uninstall.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\omniterm.exe"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$DESKTOP\OmniTerm.lnk"
  RMDir /r "$SMPROGRAMS\OmniTerm"
  RMDir "$INSTDIR"
SectionEnd
