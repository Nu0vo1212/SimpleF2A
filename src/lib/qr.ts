import jsQR from 'jsqr';
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

/* --------------------------------------------------------- 二维码解码 */

/**
 * 从图片文件解码二维码。
 *
 * 主方案：jsQR —— 纯 JS 实现，任何浏览器都能用，不依赖原生 API。
 * 辅方案：若浏览器有 BarcodeDetector，先试它（通常更快更准），失败再用 jsQR。
 *
 * 支持：拖拽上传、点击选择、粘贴剪贴板图片。
 */

export interface DecodeResult {
  text: string;
  /** 使用的解码器 */
  via: 'barcode-detector' | 'jsqr';
}

async function fileToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* 老浏览器或不支持的格式，走 Image 路径 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function drawToCanvas(source: ImageBitmap | HTMLImageElement, maxSide = 1600) {
  const sw = 'width' in source ? source.width : 0;
  const sh = 'height' in source ? source.height : 0;
  if (!sw || !sh) throw new Error('图片尺寸无效');

  // 过大图片先缩放，jsQR 在合理尺寸下识别更快更准
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

function getBarcodeDetector(): (new (opts?: { formats?: string[] }) => BarcodeDetectorLike) | null {
  const ctor = (globalThis as unknown as { BarcodeDetector?: new (o?: { formats?: string[] }) => BarcodeDetectorLike })
    .BarcodeDetector;
  return ctor ?? null;
}

export function isBarcodeDetectorSupported(): boolean {
  return getBarcodeDetector() !== null;
}

/** 解码图片中的二维码，返回文本。失败抛错。 */
export async function decodeQrFromFile(file: Blob): Promise<DecodeResult> {
  const source = await fileToBitmap(file);
  const imageData = drawToCanvas(source);

  // 1) 原生的 BarcodeDetector（如果有）
  const Detector = getBarcodeDetector();
  if (Detector) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvas.getContext('2d')?.putImageData(imageData, 0, 0);
      const detector = new Detector({ formats: ['qr_code'] });
      const found = await detector.detect(canvas);
      const hit = found.find((r) => r.rawValue);
      if (hit) return { text: hit.rawValue, via: 'barcode-detector' };
    } catch {
      /* 继续用 jsQR */
    }
  }

  // 2) jsQR：纯 JS，通用兜底
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  if (result?.data) {
    return { text: result.data, via: 'jsqr' };
  }

  throw new Error('图片中没有识别到二维码，请换一张更清晰、完整的截图');
}

/** 从剪贴板读取图片并解码（Ctrl+V 粘贴截图）。 */
export async function decodeQrFromClipboard(): Promise<DecodeResult> {
  if (!navigator.clipboard?.read) {
    throw new Error('当前浏览器不支持读取剪贴板，请用「选择图片」上传');
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'));
    if (!imageType) continue;
    const blob = await item.getType(imageType);
    return decodeQrFromFile(blob);
  }
  throw new Error('剪贴板里没有图片，请先截图或复制二维码图片');
}
