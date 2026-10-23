# Narración con la voz local de Windows "Microsoft Sabina" (español de México). No usa servicios externos.
# Uso: powershell -File tts.ps1 -Json segmentos.json -OutDir carpeta [-Rate 0]
param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$OutDir, [int]$Rate = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'es-MX' } | Select-Object -First 1
if (-not $voice) { throw 'No hay una voz en español de México instalada (Configuración > Hora e idioma > Voz).' }
$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Rate = $Rate
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$items = Get-Content -Raw -Encoding UTF8 $Json | ConvertFrom-Json
foreach ($it in $items) {
  $file = Join-Path $OutDir ($it.id + '.wav')
  if (Test-Path $file) { continue }
  $synth.SetOutputToWaveFile($file, $format)
  $synth.Speak($it.speech)
  $synth.SetOutputToNull()
}
$synth.Dispose()
Write-Output "voz: $($voice.VoiceInfo.Name)"
