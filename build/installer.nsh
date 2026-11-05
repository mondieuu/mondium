; Mondium: registers as a browser in Windows "Default apps" (like Chrome, per user, HKCU).
; The user can pick Mondium in Settings > Default apps; the installer does NOT make it the default by itself.

!define MONDIUM_KEY "Software\Clients\StartMenuInternet\Mondium"

!macro mondiumProgId PROGID DESC
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "${DESC}"
  WriteRegStr HKCU "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESC}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\Application" "ApplicationName" "Mondium"
  WriteRegStr HKCU "Software\Classes\${PROGID}\Application" "ApplicationIcon" "$INSTDIR\Mondium.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\Mondium.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\Mondium.exe" "%1"'
!macroend

!macro customInstall
  !insertmacro mondiumProgId "MondiumURL" "Mondium URL"
  WriteRegStr HKCU "Software\Classes\MondiumURL" "URL Protocol" ""
  !insertmacro mondiumProgId "MondiumHTML" "Mondium HTML Document"

  WriteRegStr HKCU "${MONDIUM_KEY}" "" "Mondium"
  WriteRegStr HKCU "${MONDIUM_KEY}\DefaultIcon" "" "$INSTDIR\Mondium.exe,0"
  WriteRegStr HKCU "${MONDIUM_KEY}\shell\open\command" "" '"$INSTDIR\Mondium.exe"'
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities" "ApplicationName" "Mondium"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities" "ApplicationDescription" "Minimal, debloated Chromium-based browser"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities" "ApplicationIcon" "$INSTDIR\Mondium.exe,0"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\StartMenu" "StartMenuInternet" "Mondium"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\URLAssociations" "http" "MondiumURL"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\URLAssociations" "https" "MondiumURL"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\FileAssociations" ".htm" "MondiumHTML"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\FileAssociations" ".html" "MondiumHTML"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\FileAssociations" ".pdf" "MondiumHTML"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\FileAssociations" ".svg" "MondiumHTML"
  WriteRegStr HKCU "${MONDIUM_KEY}\Capabilities\FileAssociations" ".webp" "MondiumHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Mondium" "${MONDIUM_KEY}\Capabilities"
  ; Notify the shell that file associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\RegisteredApplications" "Mondium"
  DeleteRegKey HKCU "${MONDIUM_KEY}"
  DeleteRegKey HKCU "Software\Classes\MondiumURL"
  DeleteRegKey HKCU "Software\Classes\MondiumHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
