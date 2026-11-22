param([string]$OutputPath = (Join-Path $PSScriptRoot 'app.ico'))
Add-Type -AssemblyName System.Drawing
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 256.0, $size / 256.0)
  $ink = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 18, 18, 18))
  $white = [Drawing.SolidBrush]::new([Drawing.Color]::White)
  $brown = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 110, 71, 38))
  $line = [Drawing.Pen]::new([Drawing.Color]::FromArgb(255, 18, 18, 18), 6)
  $line.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $graphics.FillRectangle($white, 20, 20, 216, 216)
  $graphics.DrawRectangle($line, 20, 20, 216, 216)
  $front = [Drawing.PointF[]]@([Drawing.PointF]::new(66, 54),[Drawing.PointF]::new(106, 58),[Drawing.PointF]::new(106, 202),[Drawing.PointF]::new(66, 198))
  $cover = [Drawing.PointF[]]@([Drawing.PointF]::new(106, 58),[Drawing.PointF]::new(190, 48),[Drawing.PointF]::new(190, 189),[Drawing.PointF]::new(106, 202))
  $top = [Drawing.PointF[]]@([Drawing.PointF]::new(66, 54),[Drawing.PointF]::new(147, 45),[Drawing.PointF]::new(190, 48),[Drawing.PointF]::new(106, 58))
  $graphics.FillPolygon($white, $top)
  $graphics.DrawPolygon($line, $top)
  $graphics.FillPolygon($white, $cover)
  $graphics.DrawPolygon($line, $cover)
  $graphics.FillPolygon($white, $front)
  $graphics.DrawPolygon($line, $front)
  $graphics.FillRectangle($brown, 80, 97, 12, 57)
  $graphics.FillRectangle($ink, 78, 76, 16, 4)
  $graphics.FillRectangle($ink, 78, 172, 16, 4)
  $graphics.FillRectangle($ink, 124, 88, 42, 4)
  $graphics.FillRectangle($ink, 124, 151, 38, 4)
  $memory = [IO.MemoryStream]::new()
  $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
  $images += ,$memory.ToArray()
  $memory.Dispose(); $line.Dispose(); $brown.Dispose(); $white.Dispose(); $ink.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
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
