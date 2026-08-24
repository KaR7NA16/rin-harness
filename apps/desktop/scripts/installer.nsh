; rin GUI — NSIS installer hook（占位）
;
; 接线（子任务 1 负责）：src-tauri/tauri.conf.json 的 bundle.windows.nsis.installerHooks
; 指向本文件（预期相对 src-tauri/ 为 ../scripts/installer.nsh）。Tauri v2 会把这几个
; !macro 插入生成的 NSIS 安装脚本；宏名必须与 Tauri 约定一致：
;   NSIS_HOOK_PREINSTALL / NSIS_HOOK_POSTINSTALL
;   NSIS_HOOK_PREUNINSTALL / NSIS_HOOK_POSTUNINSTALL
;
; 本文件借鉴旧项目 desktop/src-tauri/windows-installer-hooks.nsh 的「预安装/预卸载杀进程」
; 思路，重写为 rin：
;   1) 预安装 / 预卸载：回收正在运行的 rin 桌面进程与 sidecar，避免文件被锁导致安装/卸载失败。
;   2) 后安装：补建开始菜单 / 桌面快捷方式；可选注册 .rin 仓库文件关联（默认关）。
;   3) 后卸载：清理 .rin 关联（若注册过）。
;
; 注意：下面的 exe 名（rin.exe = 桌面壳；rin-sidecar.exe = sidecar，见 src-tauri/src/main.rs host_sidecar_name()）必须与 src-tauri/tauri.conf.json 的
; productName、以及 src-tauri/binaries/ 下的 sidecar 名一致；不一致时改这里。

; ---- 预安装：停掉正在运行的 rin 桌面进程与 sidecar ----
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running rin processes..."
  ; 桌面壳主进程（productName 默认 rin；若子任务 1 定为 rin-gui 则改这里）
  nsExec::ExecToLog 'taskkill /F /T /IM rin.exe'
  Pop $0
  ; 发布态 sidecar（单文件 dsh runtime，见 scripts/build-sidecar.md）
  nsExec::ExecToLog 'taskkill /F /T /IM rin-sidecar.exe'
  Pop $0
  ; 开发态直接 spawn `rin`（node bin，无独立 exe 名）——由 GUI 退出时回收，这里无需 taskkill
  Sleep 1000
!macroend

; ---- 后安装：快捷方式 + 可选 .rin 关联 ----
!macro NSIS_HOOK_POSTINSTALL
  ; Tauri 默认已按 bundle.windows.nsis 的开关建开始菜单/桌面快捷方式。此处仅作占位：
  ; 需要自定义图标或强制桌面入口时取消注释。
  ; CreateShortCut "$DESKTOP\rin.lnk" "$INSTDIR\rin.exe"
  ; CreateShortCut "$SMPROGRAMS\rin\rin.lnk" "$INSTDIR\rin.exe"
  ;
  ; 可选：把 .rin 关联为 rin 仓库文件（打开时让 GUI 收到该文件路径）。
  ; MVP 默认关闭；开启需在构建时定义 RIN_ASSOCIATE_RIN_FILES。
  !ifdef RIN_ASSOCIATE_RIN_FILES
    !insertmacro RegisterRinAssociation
  !endif
!macroend

; ---- 预卸载：停掉正在运行的进程 ----
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running rin processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM rin.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM rin-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend

; ---- 后卸载：清理 .rin 关联 ----
!macro NSIS_HOOK_POSTUNINSTALL
  !ifdef RIN_ASSOCIATE_RIN_FILES
    !insertmacro UnregisterRinAssociation
  !endif
!macroend

; ---- 辅助：注册 .rin 仓库文件关联（占位，默认不启用）----
!macro RegisterRinAssociation
  ; 扩展名 .rin → ProgId（rin.repository）
  WriteRegStr HKCR ".rin" "" "rin.repository"
  WriteRegStr HKCR "rin.repository" "" "rin repository"
  ; 打开命令：把文件路径作为参数交给 GUI。
  ; 真正的「打开仓库文件」处理在 src-tauri/src/main.rs（子任务 1）；此处只做 shell 关联。
  WriteRegStr HKCR "rin.repository\shell\open\command" "" '"$INSTDIR\rin.exe" "%1"'
  ; 可选：图标与友好名
  ; WriteRegStr HKCR "rin.repository\DefaultIcon" "" '"$INSTDIR\rin.exe",0'
  ; 通知系统刷新文件关联
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; ---- 辅助：注销 .rin 关联（占位）----
!macro UnregisterRinAssociation
  DeleteRegKey HKCR "rin.repository\shell"
  DeleteRegKey HKCR "rin.repository\DefaultIcon"
  DeleteRegKey HKCR "rin.repository"
  DeleteRegValue HKCR ".rin" ""
!macroend
