import QRCode from 'qrcode';

/** 生成二维码 SVG 字符串（用于单账户导出，可缩放不失真）。 */
export async function qrSvg(text: string, size = 220): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: { dark: '#0D1117', light: '#FFFFFF' },
  });
}

/** 生成二维码 Data URL（用于导出图片）。 */
export async function qrDataUrl(text: string, size = 512): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: '#0D1117', light: '#FFFFFF' },
  });
}

/* ------------------------------------------------- BarcodeDetector 支持 */

interface DetectedBarcode {
  rawValue: string;
  format: string;
  boundingBox?: DOMRectReadOnly;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): {
    detect(source: CanvasImageSource | ImageBitmapSource): Promise<DetectedBarcode[]>;
  };
  getSupportedFormats?: () => Promise<string[]>;
}

function getDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

export function isBarcodeDetectorSupported(): boolean {
  return getDetectorCtor() !== null;
}

export function isCameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

async function createDetector(): Promise<InstanceType<BarcodeDetectorCtor> | null> {
  const Ctor = getDetectorCtor();
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const formats = ['qr_code'].filter((f) => supported.length === 0 || supported.includes(f));
    return new Ctor({ formats: formats.length ? formats : undefined });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

/** 识别图片文件中的二维码，返回原始字符串数组。 */
export async function detectFromImageFile(file: File): Promise<string[]> {
  const detector = await createDetector();
  const bitmap = await createImageBitmap(file);
  try {
    if (!detector) return [];
    const results = await detector.detect(bitmap);
    return results.map((r) => r.rawValue).filter(Boolean);
  } finally {
    bitmap.close?.();
  }
}

/** 打开摄像头并持续识别，命中后回调并自动停止。返回 stop 函数。 */
export async function startCameraScan(
  video: HTMLVideoElement,
  onResult: (value: string) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  let stream: MediaStream | null = null;
  let raf = 0;
  let stopped = false;

  const cleanup = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();
  } catch (error) {
    cleanup();
    const name = (error as DOMException)?.name;
    if (name === 'NotAllowedError') onError('摄像头权限被拒绝，请改用上传图片或粘贴 URI');
    else if (name === 'NotFoundError') onError('未找到可用摄像头，请改用上传图片或粘贴 URI');
    else onError('无法启动摄像头，请改用上传图片或粘贴 URI');
    return () => {};
  }

  const detector = await createDetector();
  if (!detector) {
    // 没有 BarcodeDetector：保留视频预览但提示降级
    onError('当前浏览器不支持二维码识别，请改用上传图片或粘贴 URI');
  }

  const tick = async () => {
    if (stopped || !detector) return;
    try {
      if (video.readyState >= 2) {
        const results = await detector.detect(video);
        const hit = results.find((r) => r.rawValue);
        if (hit) {
          onResult(hit.rawValue);
          cleanup();
          return;
        }
      }
    } catch {
      /* 单帧识别失败不中断循环 */
    }
    raf = requestAnimationFrame(() => void tick());
  };
  if (detector) raf = requestAnimationFrame(() => void tick());

  return cleanup;
}
