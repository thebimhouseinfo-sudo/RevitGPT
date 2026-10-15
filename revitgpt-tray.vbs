' RevitGPT silent tray launcher for Windows.
' Run at interactive Windows user logon (HKCU Run). Never logs credentials.
On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If Err.Number <> 0 Then WScript.Quit 2
Err.Clear

Sub StartupLog(stage)
    On Error Resume Next
    localData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
    If Len(localData) = 0 Or InStr(localData, "%") > 0 Then Exit Sub
    If Not fso.FolderExists(localData) Then fso.CreateFolder localData
    logRoot = localData & "\RevitGPT"
    logDir = logRoot & "\logs"
    If Not fso.FolderExists(logRoot) Then fso.CreateFolder logRoot
    If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
    Set stream = fso.OpenTextFile(logDir & "\startup-launch.log", 8, True)
    If Not stream Is Nothing Then
        stream.WriteLine Now & " | " & stage
        stream.Close
    End If
    Err.Clear
End Sub

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = scriptDir & "\revitgpt-tray.ps1"
StartupLog "wscript_invoked"
If Not fso.FileExists(trayScript) Then
    StartupLog "startup_failed: TRAY_SCRIPT_MISSING"
    WScript.Quit 3
End If

args = ""
If WScript.Arguments.Count > 0 Then
    For i = 0 To WScript.Arguments.Count - 1
        ' Preserve a single argument containing spaces; refuse embedded quotes.
        If InStr(WScript.Arguments(i), Chr(34)) > 0 Then
            StartupLog "startup_failed: INVALID_ARGUMENT"
            WScript.Quit 5
        End If
        args = args & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
    Next
End If

cmd = "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & trayScript & """" & args
Err.Clear
exitCode = WshShell.Run(cmd, 0, False)
If Err.Number <> 0 Then
    StartupLog "startup_failed: POWERSHELL_DISPATCH"
    WScript.Quit 4
End If
StartupLog "powershell_dispatched"
