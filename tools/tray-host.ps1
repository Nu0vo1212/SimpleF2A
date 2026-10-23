# SimpleF2A 托盘宿主
# 由启动器以隐藏窗口方式拉起，负责：
#   - 在系统托盘显示图标
#   - 右键菜单：打开页面 / 复制地址 / 重新载入 / 退出
#   - 双击图标：重新打开浏览器
# 与 Node 主进程通过一个「控制文件」通信：
#   launcher 写命令（open/reload/quit），本脚本轮询读取后执行

param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$CommandFile,
    [string]$IconFile = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- 生成托盘图标：与网页内 Logo 一致（青色圆角底 + 锁形） ---
function New-TrayIcon {
    param([string]$Path)
    $size = 32
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # 圆角深色底
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 8
    $bgPath.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $bgPath.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $bgPath.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $bgPath.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $bgPath.CloseFigure()
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 94, 234, 212),
        [System.Drawing.Color]::FromArgb(255, 14, 116, 144))
    $g.FillPath($bgBrush, $bgPath)

    # 锁身
    $bodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 7, 9, 12))
    $body = New-Object System.Drawing.RectangleF(9, 14, 14, 11)
    $g.FillRectangle($bodyBrush, $body)

    # 锁梁
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 7, 9, 12), 2.6)
    $g.DrawArc($pen, 11.5, 7.5, 9, 10, 180, 180)

    # 锁孔
    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 94, 234, 212))
    $g.FillEllipse($dotBrush, 14.5, 17.5, 3, 3)

    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    $bgBrush.Dispose(); $bodyBrush.Dispose(); $pen.Dispose(); $dotBrush.Dispose(); $bgPath.Dispose()
    return $Path
}

# 注意：不要删除 $IconFile —— launcher 已经把 app.ico 释放到该路径，托盘需要读取它。

# --- 取托盘图标 ---
# 优先使用传入的 .ico（launcher 从 exe 内嵌资源释放），
# 其次从 exe 自身提取，最后退回系统保险图标。
function Get-TrayIcon {
    param([string]$IcoPath)

    # 1) 传入的 .ico
    if (-not [string]::IsNullOrWhiteSpace($IcoPath) -and (Test-Path $IcoPath)) {
        try {
            return New-Object System.Drawing.Icon($IcoPath)
        } catch { }
    }

    # 2) 从当前 exe 提取关联图标
    try {
        $exePath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
        if ($ico) { return $ico }
    } catch { }

    # 3) 脚本同目录的 app.ico
    try {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        foreach ($candidate in @("$scriptDir\app.ico", "$scriptDir\..\app.ico")) {
            if (Test-Path $candidate) {
                return New-Object System.Drawing.Icon($candidate)
            }
        }
    } catch { }

    # 4) 系统兜底
    return [System.Drawing.SystemIcons]::Shield
}

$icon = Get-TrayIcon -IcoPath $IconFile

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = "SimpleF2A · 本地验证器"
$notify.Visible = $true

# --- 菜单 ---
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.ShowImageMargin = $false

$itemOpen = $menu.Items.Add("打开 SimpleF2A")
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)

$itemUrl = $menu.Items.Add("复制访问地址")
$menu.Items.Add("-") | Out-Null
$itemReload = $menu.Items.Add("刷新页面")
$menu.Items.Add("-") | Out-Null
$itemQuit = $menu.Items.Add("退出")

function Open-Page {
    Start-Process $Url
}

$itemOpen.add_Click({ Open-Page })
$itemUrl.add_Click({
    try {
        Set-Clipboard -Value $Url
        $notify.ShowBalloonTip(1500, "SimpleF2A", "地址已复制：$Url", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        $notify.ShowBalloonTip(1500, "SimpleF2A", $Url, [System.Windows.Forms.ToolTipIcon]::Info)
    }
})
$itemReload.add_Click({
    try {
        Set-Content -Path $CommandFile -Value "reload" -Encoding utf8
        $notify.ShowBalloonTip(1200, "SimpleF2A", "已请求刷新页面", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch { }
})
$itemQuit.add_Click({
    try { Set-Content -Path $CommandFile -Value "quit" -Encoding utf8 } catch { }
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Open-Page })
$notify.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        # 单击也打开（托盘图标常见直觉）
        Open-Page
    }
})

# --- 运行消息循环，同时监控退出/命令文件 ---
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.add_Tick({
    if (-not (Test-Path $CommandFile)) { return }
    $cmd = (Get-Content $CommandFile -Raw -ErrorAction SilentlyContinue)
    if ([string]::IsNullOrWhiteSpace($cmd)) { return }
    $cmd = $cmd.Trim()
    Remove-Item $CommandFile -Force -ErrorAction SilentlyContinue
    switch ($cmd) {
        "quit" {
            $notify.Visible = $false
            $notify.Dispose()
            [System.Windows.Forms.Application]::Exit()
        }
        "reload" {
            # 打开页面即等同于重新载入（浏览器会复用标签）
            Start-Process $Url
        }
        "open" { Open-Page }
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
