# find-dsh.ps1：查找 dsh web 相关 node/cmd 进程 PID
$nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dsh' -and $_.CommandLine -match 'web' }
$cmdProcs = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'dsh web' }
$all = @()
foreach ($p in $nodeProcs) { $all += $p.ProcessId }
foreach ($p in $cmdProcs) { $all += $p.ProcessId }
$all | Sort-Object -Unique | ForEach-Object { Write-Output $_ }
