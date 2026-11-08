; Mondium: registers as a browser in Windows "Default apps" (like Chrome, per user, HKCU).
; The user can pick Mondium in Settings > Default apps; the installer does NOT make it the default by itself.

;
; The installer and uninstaller screens: a dark band with the ring and name, one sentence, one button.
; Silent runs (/S, used by the updater and by an old version's removal) show none of this and never delete user data.

!define MONDIUM_KEY "Software\Clients\StartMenuInternet\Mondium"
!define MONDIUM_INK 1F1F22
!define MONDIUM_GRAY 66666E
!define MONDIUM_BG FFFFFF

; The variables of the removed install mode page stay declared by the template
!pragma warning disable 6001

!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.mondiumGuiInit
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT mondiumGuiInit
!endif

!macro mondiumHide ITEM
  GetDlgItem $0 $HWNDPARENT ${ITEM}
  ShowWindow $0 ${SW_HIDE}
!macroend

!macro mondiumArt DPI
  File "/oname=$PLUGINSDIR\mondium-art.bmp" "${BUILD_RESOURCES_DIR}\installer\art-${DPI}.bmp"
!macroend

; Shared by both programs, UN is "" or "un."
!macro mondiumScreens UN
  Function ${UN}mondiumGuiInit
    InitPluginsDir
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Mondium"
    CreateFont $mondiumTitleFont "Segoe UI Semibold" 12 600
    CreateFont $mondiumTextFont "Segoe UI" 9 400

    ; Smaller than the template's window, still centered: width $3, height $4, reduced by $5 and $6
    System::Call '*(i,i,i,i) p.r2'
    System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r2)'
    System::Call '*$2(i.r0,i.r1,i.r3,i.r4)'
    IntOp $3 $3 - $0
    IntOp $4 $4 - $1
    IntOp $5 $3 / 8
    IntOp $6 $4 / 6
    IntOp $7 $5 / 2
    IntOp $0 $0 + $7
    IntOp $7 $6 / 2
    IntOp $1 $1 + $7
    IntOp $3 $3 - $5
    IntOp $4 $4 - $6
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i r3, i r4, i 0x14)'
    StrCpy $7 1
    ${Do}
      GetDlgItem $0 $HWNDPARENT $7
      System::Call 'user32::GetWindowRect(p r0, p r2)'
      System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r2, i 2)'
      System::Call '*$2(i.r8,i.r9)'
      IntOp $8 $8 - $5
      IntOp $9 $9 - $6
      System::Call 'user32::SetWindowPos(p r0, p 0, i r8, i r9, i 0, i 0, i 0x15)'
      IntOp $7 $7 + 1
    ${LoopUntil} $7 > 2
    System::Free $2

    System::Call 'user32::GetDC(p 0) p.r0'
    System::Call 'gdi32::GetDeviceCaps(p r0, i 88) i.r1'
    System::Call 'user32::ReleaseDC(p 0, p r0)'
    ${If} $1 < 120
      !insertmacro mondiumArt 96
    ${ElseIf} $1 < 144
      !insertmacro mondiumArt 120
    ${ElseIf} $1 < 168
      !insertmacro mondiumArt 144
    ${ElseIf} $1 < 192
      !insertmacro mondiumArt 168
    ${ElseIf} $1 < 240
      !insertmacro mondiumArt 192
    ${ElseIf} $1 < 288
      !insertmacro mondiumArt 240
    ${Else}
      !insertmacro mondiumArt 288
    ${EndIf}

    ; Width $3, height $4 of the window, top $5 of the buttons
    System::Call '*(i,i,i,i) p.r2'
    System::Call 'user32::GetClientRect(p $HWNDPARENT, p r2)'
    System::Call '*$2(i,i,i.r3,i.r4)'
    GetDlgItem $0 $HWNDPARENT 1
    System::Call 'user32::GetWindowRect(p r0, p r2)'
    System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r2, i 2)'
    System::Call '*$2(i,i.r5)'
    System::Free $2

    SetCtlColors $HWNDPARENT 000000 ${MONDIUM_BG}
    !insertmacro mondiumHide 1034
    !insertmacro mondiumHide 1035
    !insertmacro mondiumHide 1036
    !insertmacro mondiumHide 1037
    !insertmacro mondiumHide 1038
    !insertmacro mondiumHide 1039
    !insertmacro mondiumHide 1028
    !insertmacro mondiumHide 1256
    !insertmacro mondiumHide 1045
    !insertmacro mondiumHide 3

    ; The band: a picture centered in the control, on the picture's own background color
    IntOp $6 $4 * 48
    IntOp $6 $6 / 100
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000020E, i 0, i 0, i r3, i r6, p $HWNDPARENT, p 0, p 0, p 0) p.r0'
    SetCtlColors $0 FFFFFF ${MONDIUM_INK}
    System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\mondium-art.bmp", i 0, i 0, i 0, i 0x10) p.r1'
    SendMessage $0 0x0172 0 $1
    System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i r3, i r6, i 0x14)'

    ; Pages go in the place of control 1018, between the band and the buttons
    GetDlgItem $0 $HWNDPARENT 1018
    IntOp $1 $3 / 22
    IntOp $2 $1 * 2
    IntOp $2 $3 - $2
    IntOp $5 $5 - $6
    System::Call 'user32::SetWindowPos(p r0, p 0, i r1, i r6, i r2, i r5, i 0x14)'
  FunctionEnd

  ; One sentence in the page, and a smaller line below it
  Function ${UN}mondiumPage
    Exch $R2 ; second line
    Exch
    Exch $R1 ; first line
    Exch 2
    Exch $R0 ; button
    !insertmacro mondiumHide 3
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$R0"
    nsDialogs::Create 1018
    Pop $mondiumPageDlg
    SetCtlColors $mondiumPageDlg 000000 ${MONDIUM_BG}
    ${NSD_CreateLabel} 0 10u 100% 14u "$R1"
    Pop $0
    SetCtlColors $0 ${MONDIUM_INK} ${MONDIUM_BG}
    SendMessage $0 ${WM_SETFONT} $mondiumTitleFont 1
    ${NSD_CreateLabel} 0 26u 100% 20u "$R2"
    Pop $0
    SetCtlColors $0 ${MONDIUM_GRAY} ${MONDIUM_BG}
    SendMessage $0 ${WM_SETFONT} $mondiumTextFont 1
    Pop $R0
    Pop $R2
    Pop $R1
  FunctionEnd

  ; The progress page. No buttons while it works; they can't do anything then.
  Function ${UN}mondiumWorkShow
    Exch $R0 ; text
    !insertmacro mondiumHide 1
    !insertmacro mondiumHide 2
    !insertmacro mondiumHide 3
    FindWindow $1 "#32770" "" $HWNDPARENT
    SetCtlColors $1 000000 ${MONDIUM_BG}

    System::Call '*(i,i,i,i) p.r2'
    GetDlgItem $0 $HWNDPARENT 1018
    System::Call 'user32::GetClientRect(p r0, p r2)'
    System::Call '*$2(i,i,i.r3,i.r4)'
    System::Free $2
    System::Call 'user32::SetWindowPos(p r1, p 0, i 0, i 0, i r3, i r4, i 0x16)'

    GetDlgItem $0 $1 1006
    SetCtlColors $0 ${MONDIUM_GRAY} ${MONDIUM_BG}
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $1 1016
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $1 1027
    ShowWindow $0 ${SW_HIDE}

    System::Call 'user32::GetDC(p 0) p.r2'
    System::Call 'gdi32::GetDeviceCaps(p r2, i 88) i.r5'
    System::Call 'user32::ReleaseDC(p 0, p r2)'
    IntOp $6 $5 * 26 ; top of the text
    IntOp $6 $6 / 96
    IntOp $7 $5 * 24 ; height of the text
    IntOp $7 $7 / 96
    IntOp $8 $5 * 60 ; top of the bar
    IntOp $8 $8 / 96
    IntOp $9 $5 * 8 ; height of the bar, before its edge is cut off
    IntOp $9 $9 / 96

    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "$R0", i 0x50000000, i 0, i r6, i r3, i r7, p r1, p 0, p 0, p 0) p.r0'
    StrCpy $mondiumWorkText $0
    SetCtlColors $0 ${MONDIUM_INK} ${MONDIUM_BG}
    SendMessage $0 ${WM_SETFONT} $mondiumTitleFont 1

    GetDlgItem $0 $1 1006
    System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i r8, i r3, i r7, i 0x14)'

    GetDlgItem $0 $1 1004
    System::Call 'uxtheme::SetWindowTheme(p r0, w "", w "")'
    System::Call 'user32::SetWindowLongPtrW(p r0, i -20, p 0)'
    System::Call 'user32::SetWindowLongPtrW(p r0, i -16, p 0x50000001)'
    SendMessage $0 0x0409 0 0x00221F1F
    SendMessage $0 0x2001 0 0x00EAE8E8
    System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i r8, i r3, i r9, i 0x34)'
    IntOp $3 $3 - 2
    IntOp $9 $9 - 2
    System::Call 'gdi32::CreateRectRgn(i 2, i 2, i r3, i r9) p.r2'
    System::Call 'user32::SetWindowRgn(p r0, p r2, i 1)'
    Pop $R0
  FunctionEnd

  ; When a step fails the reason stays on screen, with a way to close the window
  Function ${UN}mondiumWorkFailed
    Exch $R0
    ${IfNot} ${Silent}
      SendMessage $mondiumWorkText ${WM_SETTEXT} 0 "STR:$R0"
      FindWindow $1 "#32770" "" $HWNDPARENT
      GetDlgItem $0 $1 1004
      ShowWindow $0 ${SW_HIDE}
      GetDlgItem $0 $1 1006
      ShowWindow $0 ${SW_SHOW}
      GetDlgItem $0 $HWNDPARENT 2
      ShowWindow $0 ${SW_SHOW}
    ${EndIf}
    Pop $R0
  FunctionEnd
!macroend

; Inserted once the languages are loaded
!macro customHeader
  Caption "Mondium"
  UninstallCaption "Mondium"
  SetFont "Segoe UI" 9
  ManifestDPIAware true

  Var /GLOBAL mondiumTitleFont
  Var /GLOBAL mondiumTextFont
  Var /GLOBAL mondiumPageDlg
  Var /GLOBAL mondiumWorkText

  !ifdef BUILD_UNINSTALLER
    LangString mondiumUnTitle ${LANG_TURKISH} "Mondium kaldırılacak"
    LangString mondiumUnTitle ${LANG_ENGLISH} "Remove Mondium"
    LangString mondiumUnNote ${LANG_TURKISH} "Program bu bilgisayardan silinir."
    LangString mondiumUnNote ${LANG_ENGLISH} "The program will be deleted from this computer."
    LangString mondiumUnData ${LANG_TURKISH} "Yer işaretlerini, geçmişi, ayarları ve oturumları da sil (geri alınamaz)"
    LangString mondiumUnData ${LANG_ENGLISH} "Also delete bookmarks, history, settings and sign-ins (can't be undone)"
    LangString mondiumUnButton ${LANG_TURKISH} "Kaldır"
    LangString mondiumUnButton ${LANG_ENGLISH} "Remove"
    LangString mondiumUnCancel ${LANG_TURKISH} "Vazgeç"
    LangString mondiumUnCancel ${LANG_ENGLISH} "Cancel"
    LangString mondiumUnWork ${LANG_TURKISH} "Kaldırılıyor..."
    LangString mondiumUnWork ${LANG_ENGLISH} "Removing..."
    LangString mondiumUnFailed ${LANG_TURKISH} "Kaldırma tamamlanamadı"
    LangString mondiumUnFailed ${LANG_ENGLISH} "Mondium could not be removed"
    LangString mondiumUnDone ${LANG_TURKISH} "Mondium kaldırıldı"
    LangString mondiumUnDone ${LANG_ENGLISH} "Mondium was removed"
    LangString mondiumUnKept ${LANG_TURKISH} "Yer işaretleriniz ve ayarlarınız duruyor. Yeniden kurarsanız geri gelir."
    LangString mondiumUnKept ${LANG_ENGLISH} "Your bookmarks and settings are still here. They come back if you install it again."
    LangString mondiumUnGone ${LANG_TURKISH} "Verileriniz de silindi."
    LangString mondiumUnGone ${LANG_ENGLISH} "Your data was deleted too."
    LangString mondiumUnClose ${LANG_TURKISH} "Kapat"
    LangString mondiumUnClose ${LANG_ENGLISH} "Close"

    Var /GLOBAL mondiumDeleteBox
    Var /GLOBAL mondiumDeleteData

    !insertmacro mondiumScreens un.

    Function un.mondiumWelcome
      Push "$(mondiumUnButton)"
      Push "$(mondiumUnTitle)"
      Push "$(mondiumUnNote)"
      Call un.mondiumPage
      GetDlgItem $0 $HWNDPARENT 2
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(mondiumUnCancel)"
      ; Off by default: keeping the data is the safe answer
      ${NSD_CreateCheckbox} 0 46u 100% 20u "$(mondiumUnData)"
      Pop $mondiumDeleteBox
      SetCtlColors $mondiumDeleteBox ${MONDIUM_INK} ${MONDIUM_BG}
      SendMessage $mondiumDeleteBox ${WM_SETFONT} $mondiumTextFont 1
      nsDialogs::Show
    FunctionEnd

    Function un.mondiumWelcomeLeave
      ${NSD_GetState} $mondiumDeleteBox $mondiumDeleteData
    FunctionEnd

    Function un.mondiumWorkPage
      Push "$(mondiumUnWork)"
      Call un.mondiumWorkShow
    FunctionEnd

    Function un.onUninstFailed
      Push "$(mondiumUnFailed)"
      Call un.mondiumWorkFailed
    FunctionEnd

    Function un.mondiumDone
      ${If} $mondiumDeleteData == ${BST_CHECKED}
        StrCpy $1 "$(mondiumUnGone)"
      ${Else}
        StrCpy $1 "$(mondiumUnKept)"
      ${EndIf}
      GetDlgItem $0 $HWNDPARENT 1
      ShowWindow $0 ${SW_SHOW}
      EnableWindow $0 1
      GetDlgItem $5 $HWNDPARENT 2
      System::Call '*(i,i,i,i) p.r2'
      System::Call 'user32::GetWindowRect(p r5, p r2)'
      System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r2, i 2)'
      System::Call '*$2(i.r3,i.r4)'
      System::Free $2
      System::Call 'user32::SetWindowPos(p r0, p 0, i r3, i r4, i 0, i 0, i 0x15)'
      Push "$(mondiumUnClose)"
      Push "$(mondiumUnDone)"
      Push "$1"
      Call un.mondiumPage
      nsDialogs::Show
    FunctionEnd

    Function un.mondiumSkipPage
      Abort
    FunctionEnd
  !else
    LangString mondiumTitle ${LANG_TURKISH} "Mondium kurulmaya hazır"
    LangString mondiumTitle ${LANG_ENGLISH} "Mondium is ready to install"
    LangString mondiumNote ${LANG_TURKISH} "Sade, hafif ve gizliliğinize saygılı bir tarayıcı."
    LangString mondiumNote ${LANG_ENGLISH} "A simple, light browser that respects your privacy."
    LangString mondiumButton ${LANG_TURKISH} "Kur"
    LangString mondiumButton ${LANG_ENGLISH} "Install"
    LangString mondiumUpTitle ${LANG_TURKISH} "Mondium güncellenecek"
    LangString mondiumUpTitle ${LANG_ENGLISH} "Mondium will be updated"
    LangString mondiumUpNote ${LANG_TURKISH} "Yer işaretleriniz, ayarlarınız ve oturumlarınız korunur."
    LangString mondiumUpNote ${LANG_ENGLISH} "Your bookmarks, settings and sign-ins are kept."
    LangString mondiumUpButton ${LANG_TURKISH} "Güncelle"
    LangString mondiumUpButton ${LANG_ENGLISH} "Update"
    LangString mondiumWork ${LANG_TURKISH} "Kuruluyor..."
    LangString mondiumWork ${LANG_ENGLISH} "Installing..."
    LangString mondiumFailed ${LANG_TURKISH} "Kurulum tamamlanamadı"
    LangString mondiumFailed ${LANG_ENGLISH} "Mondium could not be installed"

    !insertmacro mondiumScreens ""

    Function mondiumWelcome
      ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $0 == ""
        Push "$(mondiumButton)"
        Push "$(mondiumTitle)"
        Push "$(mondiumNote)"
      ${Else}
        Push "$(mondiumUpButton)"
        Push "$(mondiumUpTitle)"
        Push "$(mondiumUpNote)"
      ${EndIf}
      Call mondiumPage
      nsDialogs::Show
    FunctionEnd

    Function mondiumWorkPage
      Push "$(mondiumWork)"
      Call mondiumWorkShow
    FunctionEnd

    Function .onInstFailed
      Push "$(mondiumFailed)"
      Call mondiumWorkFailed
    FunctionEnd

    ; Done: the browser opens and this window goes away
    Function mondiumOpen
      HideWindow
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
      SetErrorLevel 0
      Quit
    FunctionEnd
  !endif
!macroend

!macro customWelcomePage
  !macroundef PAGE_INSTALL_MODE
  !include "installer-no-mode-page.nsh"
  Page custom mondiumWelcome
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW mondiumWorkPage
!macroend

!macro customFinishPage
  Page custom mondiumOpen
!macroend

!macro customUnWelcomePage
  !macroundef PAGE_INSTALL_MODE
  !include "installer-no-mode-page.nsh"
  UninstPage custom un.mondiumWelcome un.mondiumWelcomeLeave
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.mondiumWorkPage
!macroend

; The template adds its finish page right after this; ours takes its place
!macro customUninstallPage
  UninstPage custom un.mondiumDone
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.mondiumSkipPage
!macroend

!macro customInit
  !insertmacro setInstallModePerUser
!macroend

!macro customUnInit
  !insertmacro setInstallModePerUser
!macroend

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
  SetAutoClose true
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\RegisteredApplications" "Mondium"
  DeleteRegKey HKCU "${MONDIUM_KEY}"
  DeleteRegKey HKCU "Software\Classes\MondiumURL"
  DeleteRegKey HKCU "Software\Classes\MondiumHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Only from the box on the uninstall screen, which a silent run never reaches. Mondium is closed by now.
  ${If} $mondiumDeleteData == ${BST_CHECKED}
    RMDir /r "$APPDATA\Mondium"
  ${EndIf}
  SetAutoClose true
!macroend
