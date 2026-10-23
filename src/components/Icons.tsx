import { MorphIcon } from 'morphicons/react';
import type { MorphIconProps } from 'morphicons/react';
import {
  Plus,
  Search,
  Image as ImageIcon,
  Settings2,
  Sun,
  Moon,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Pencil,
  Download,
  MoreHorizontal,
  X,
  ShieldCheck,
  ShieldAlert,
  Camera,
  Upload,
  ClipboardPaste,
  Keyboard,
  QrCode,
  Wand2,
  Loader2,
  FileJson,
  Palette,
  AlertTriangle,
  Lock,
  Unlock,
  ChevronRight,
  Sparkles,
} from 'lucide';

/**
 * 统一图标出口 —— 基于 morphicons + lucide 图标数据。
 *
 * morphicons 用 spring 物理在两种形态之间插值（path morphing），
 * 因此「复制 → 已复制」「太阳 → 月亮」这类状态切换是形状渐变而非硬切。
 *
 * 注意：lucide 提供的是图标数据（IconNode），不是 React 组件，
 * 这正是 morphicons 要求的输入格式。
 */

export const icons = {
  add: Plus,
  search: Search,
  background: ImageIcon,
  settings: Settings2,
  sun: Sun,
  moon: Moon,
  copy: Copy,
  check: Check,
  refresh: RefreshCw,
  trash: Trash2,
  edit: Pencil,
  download: Download,
  more: MoreHorizontal,
  close: X,
  shield: ShieldCheck,
  shieldAlert: ShieldAlert,
  camera: Camera,
  upload: Upload,
  paste: ClipboardPaste,
  keyboard: Keyboard,
  qr: QrCode,
  wand: Wand2,
  loader: Loader2,
  fileJson: FileJson,
  palette: Palette,
  warning: AlertTriangle,
  lock: Lock,
  unlock: Unlock,
  chevron: ChevronRight,
  sparkles: Sparkles,
} as const;

export type IconName = keyof typeof icons;

interface IconProps extends Omit<MorphIconProps, 'icon'> {
  name: IconName;
  /** 切换时使用的动画强度 */
  spring?: 'snappy' | 'smooth' | 'bouncy';
}

/** 按名字渲染单个图标（不参与 morph，仅用于静态图标） */
export function Icon({ name, size = 16, spring = 'snappy', ...rest }: IconProps) {
  return (
    <MorphIcon
      icon={icons[name]}
      size={size}
      spring={spring}
      reducedMotion="user"
      aria-hidden="true"
      {...rest}
    />
  );
}

export { MorphIcon };
