#Requires AutoHotkey v2.0
#SingleInstance Force

MyHotkey := "^+b"  ; Ctrl+Shift+B — change this to your preferred combo

Hotkey MyHotkey, Capture

Capture(*) {
    ; Get foreground window before anything steals focus
    hwnd := WinGetID("A")
    procName := WinGetProcessName("A")

    source := "desktop"
    if InStr(procName, "Teams")
        source := "teams"
    else if InStr(procName, "OUTLOOK")
        source := "outlook"
    else if InStr(procName, "chrome")
        source := "browser-selection"
    else if InStr(procName, "msedge")
        source := "browser-selection"
    else if InStr(procName, "WINWORD")
        source := "word"
    else if InStr(procName, "POWERPNT")
        source := "powerpoint"
    else if InStr(procName, "ONENOTE")
        source := "onenote"
    else if InStr(procName, "WindowsTerminal")
        source := "terminal"

    ; Copy selection to clipboard
    A_Clipboard := ""
    Send "^c"
    ClipWait 1
    content := A_Clipboard

    if (content = "") {
        TrayTip "Open Brain", "Nothing selected to capture.", 2
        return
    }

    ; Read key from environment
    key := EnvGet("OPEN_BRAIN_KEY")
    if (key = "") {
        TrayTip "Open Brain", "OPEN_BRAIN_KEY not set.", 2
        return
    }

    ; Build JSON body — escape content for JSON
    content := StrReplace(content, "\", "\\")
    content := StrReplace(content, '"', '\"')
    content := StrReplace(content, "`n", "\n")
    content := StrReplace(content, "`r", "")
    body := '{"content":"' content '","source":"' source '"}'

    ; POST to capture-external
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("POST", "http://localhost:3100/capture-external", false)
    req.SetRequestHeader("Content-Type", "application/json")
    req.SetRequestHeader("x-brain-key", key)
    req.Send(body)

    if (req.Status = 200) {
        resp := req.ResponseText
        TrayTip "Open Brain", "Captured (" source ")", 2
    } else {
        TrayTip "Open Brain", "Capture failed: " req.Status, 2
    }
}
