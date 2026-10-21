$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screenBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$screenBitmap = New-Object System.Drawing.Bitmap($screenBounds.Width, $screenBounds.Height)
$screenGraphics = [System.Drawing.Graphics]::FromImage($screenBitmap)
try {
  $screenGraphics.CopyFromScreen($screenBounds.Location, [System.Drawing.Point]::Empty, $screenBounds.Size)
  $screenBitmap.Save($env:UF_NATIVE_SCREENSHOT, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $screenGraphics.Dispose()
  $screenBitmap.Dispose()
}
