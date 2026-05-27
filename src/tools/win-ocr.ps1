param([string]$ImagePath)

$ErrorActionPreference = "Stop"

# Normalize path separators for WinRT StorageFile
$ImagePath = $ImagePath.Replace('/', '\')

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Drawing
} catch {
    # Optional fallback
}

[Windows.Media.Ocr.OcrEngine, Windows.Media, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Media, ContentType=WindowsRuntime] | Out-Null

if (-not (Test-Path $ImagePath)) {
    Write-Output '{"success": false, "error": "Image file not found"}'
    exit 1
}

# Helper to wait for WinRT async operations with an explicit Type object
function Await-WinRT($WinRtTask, [Type]$ResultType) {
    if ($null -eq $WinRtTask) { return $null }
    
    # Get all GetAwaiter methods
    $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "GetAwaiter" }
    
    # Find the generic GetAwaiter
    $method = $methods | Where-Object { $_.IsGenericMethod } | Select-Object -First 1
    
    if ($null -eq $method) {
        throw "Could not find generic GetAwaiter method"
    }
    
    $genericMethod = $method.MakeGenericMethod($ResultType)
    $awaiter = $genericMethod.Invoke($null, @($WinRtTask))
    
    return $awaiter.GetResult()
}

try {
    # 1. Load original image via GDI+ and upscale by 2x using HighQualityBicubic for better OCR accuracy
    $original = [System.Drawing.Image]::FromFile($ImagePath)
    $newWidth = $original.Width * 2
    $newHeight = $original.Height * 2
    
    $resizedBitmap = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($resizedBitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($original, 0, 0, $newWidth, $newHeight)
    
    # Save the upscaled image to a temporary memory stream
    $memoryStream = New-Object System.IO.MemoryStream
    $resizedBitmap.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memoryStream.ToArray()
    
    # Clean up GDI+ resources
    $graphics.Dispose()
    $resizedBitmap.Dispose()
    $original.Dispose()
    $memoryStream.Dispose()
    
    # 2. Convert memory bytes to WinRT stream
    $winrtStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($winrtStream)
    $writer.WriteBytes($bytes)
    $null = Await-WinRT ($writer.StoreAsync()) ([uint32])
    $null = Await-WinRT ($writer.FlushAsync()) ([bool])
    $winrtStream.Seek(0)

    # 3. Decode bitmap from WinRT stream
    $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($winrtStream)
    $decoder = Await-WinRT $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])

    $bitmapTask = $decoder.GetSoftwareBitmapAsync()
    $bitmap = Await-WinRT $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])

    # 4. Run OCR
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
        Write-Output '{"success": false, "error": "No OCR engine available for user languages"}'
        exit 1
    }

    $resultTask = $engine.RecognizeAsync($bitmap)
    $result = Await-WinRT $resultTask ([Windows.Media.Ocr.OcrResult])

    # Format to JSON, dividing coordinates by 2 to map back to original screen coordinates
    $words = @()
    foreach ($line in $result.Lines) {
        foreach ($word in $line.Words) {
            $words += @{
                text = $word.Text
                boundingBox = @{
                    x = [math]::Round($word.BoundingRect.X / 2)
                    y = [math]::Round($word.BoundingRect.Y / 2)
                    width = [math]::Round($word.BoundingRect.Width / 2)
                    height = [math]::Round($word.BoundingRect.Height / 2)
                }
            }
        }
    }

    $output = @{
        success = $true
        text = $result.Text
        blocks = $words
    }

    $output | ConvertTo-Json -Depth 4 -Compress
} catch {
    $err = @{
        success = $false
        error = $_.Exception.Message
    }
    $err | ConvertTo-Json -Compress
}
