' RevitGPT silent tray launcher for Windows.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = scriptDir & "\revitgpt-tray.ps1"

args = ""
If WScript.Arguments.Count > 0 Then
    For i = 0 To WScript.Arguments.Count - 1
        args = args & " " & WScript.Arguments(i)
    Next
End If

cmd = "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & trayScript & """" & args
WshShell.Run cmd, 0, False
