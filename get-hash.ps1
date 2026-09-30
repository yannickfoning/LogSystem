$wc = New-Object System.Net.WebClient
$data = $wc.DownloadData('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js')
$hash = [System.Security.Cryptography.SHA384]::Create().ComputeHash($data)
$hashString = [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
Write-Output ('sha384-' + $hashString)