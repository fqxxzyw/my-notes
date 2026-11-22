param([string]$OutputPath)
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'app.ico' }
Add-Type -AssemblyName System.Drawing

function New-RoundedBox([single]$x, [single]$y, [single]$width, [single]$height, [single]$radius) {
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = 2 * $radius
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

# Recreate the supplied HTML logo: white rounded square, 2px black outline
# and offset shadow, with a centred brown book spine and black outline.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 256.0, $size / 256.0)
  $ink = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 17, 17, 17))
  $white = [Drawing.SolidBrush]::new([Drawing.Color]::White)
  $brown = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 110, 71, 38))
  $shadow = New-RoundedBox 32 32 200 200 44
  $outline = New-RoundedBox 16 16 200 200 44
  $inside = New-RoundedBox 31 31 170 170 29
  $graphics.FillPath($ink, $shadow)
  $graphics.FillPath($ink, $outline)
  $graphics.FillPath($white, $inside)
  $graphics.FillRectangle($ink, 94, 63, 44, 106)
  $graphics.FillRectangle($brown, 101, 70, 30, 92)
  $memory = [IO.MemoryStream]::new()
  $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
  $images += ,$memory.ToArray()
  $memory.Dispose(); $inside.Dispose(); $outline.Dispose(); $shadow.Dispose()
  $brown.Dispose(); $white.Dispose(); $ink.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$file = [IO.File]::Open($OutputPath, [IO.FileMode]::Create)
$writer = [IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $side = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
  $writer.Write([byte]$side); $writer.Write([byte]$side); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($image in $images) { $writer.Write([byte[]]$image) }
$writer.Dispose()
