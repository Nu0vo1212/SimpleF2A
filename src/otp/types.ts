export type OtpType = 'totp' | 'hotp' | 'steam' | 'yandex' | 'motp';
export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512' | 'MD5';

/** 一种 OTP 类型的规格：决定表单可用项、默认值与算法约束。 */
export interface OtpTypeSpec {
  type: OtpType;
  label: string;
  /** 该类型是否允许用户改算法 */
  algorithmFixed: OtpAlgorithm | null;
  /** 该类型是否允许用户改位数 */
  digitsFixed: number | null;
  /** 时间型（含周期倒计时）还是计数器型 */
  kind: 'time' | 'counter';
  defaultDigits: number;
  defaultPeriod: number;
  defaultAlgorithm: OtpAlgorithm;
  /** 是否支持算法选项集合 */
  algorithms: OtpAlgorithm[];
  /** 是否要求 PIN */
  requiresPin: false | { min: number; max: number; label: string };
  description: string;
}

export const OTP_TYPE_SPECS: Record<OtpType, OtpTypeSpec> = {
  totp: {
    type: 'totp',
    label: 'TOTP',
    algorithmFixed: null,
    digitsFixed: null,
    kind: 'time',
    defaultDigits: 6,
    defaultPeriod: 30,
    defaultAlgorithm: 'SHA1',
    algorithms: ['SHA1', 'SHA256', 'SHA512'],
    requiresPin: false,
    description: '基于时间的一次性密码（RFC 6238），绝大多数服务使用此类型。',
  },
  hotp: {
    type: 'hotp',
    label: 'HOTP',
    algorithmFixed: null,
    digitsFixed: null,
    kind: 'counter',
    defaultDigits: 6,
    defaultPeriod: 30,
    defaultAlgorithm: 'SHA1',
    algorithms: ['SHA1', 'SHA256', 'SHA512'],
    requiresPin: false,
    description: '基于计数器的一次性密码（RFC 4226），需要手动递增计数器。',
  },
  steam: {
    type: 'steam',
    label: 'Steam Guard',
    algorithmFixed: 'SHA1',
    digitsFixed: 5,
    kind: 'time',
    defaultDigits: 5,
    defaultPeriod: 30,
    defaultAlgorithm: 'SHA1',
    algorithms: ['SHA1'],
    requiresPin: false,
    description: 'Steam 专用编码：5 位字符，取自 26 字母字典。',
  },
  yandex: {
    type: 'yandex',
    label: 'Yandex',
    algorithmFixed: 'SHA256',
    digitsFixed: 8,
    kind: 'time',
    defaultDigits: 8,
    defaultPeriod: 30,
    defaultAlgorithm: 'SHA256',
    algorithms: ['SHA256'],
    requiresPin: { min: 4, max: 16, label: 'PIN' },
    description: 'Yandex.Key 专用：SHA-256 / 8 位，secret 需与 PIN 组合派生。',
  },
  motp: {
    type: 'motp',
    label: 'MOTP',
    algorithmFixed: 'MD5',
    digitsFixed: 6,
    kind: 'time',
    defaultDigits: 6,
    defaultPeriod: 10,
    defaultAlgorithm: 'MD5',
    algorithms: ['MD5'],
    requiresPin: { min: 4, max: 4, label: 'PIN（4 位）' },
    description: 'Mobile-OTP：MD5(时间戳 + secret + PIN) 取 6 位十六进制。',
  },
};

export const OTP_TYPES: OtpType[] = ['totp', 'hotp', 'steam', 'yandex', 'motp'];

export function isOtpType(value: unknown): value is OtpType {
  return typeof value === 'string' && OTP_TYPES.includes(value as OtpType);
}

/**
 * 账号记录（解密后的明文结构）。
 * 该对象会被序列化后写入浏览器 IndexedDB。
 */
export interface OtpAccount {
  id: string;
  type: OtpType;
  issuer: string;
  account: string;
  /** Base32 secret，仅存在于内存与密文内 */
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
  /** Yandex / MOTP 使用的 PIN，可为空 */
  pin?: string;
  icon?: string;
  color?: string;
  note?: string;
  /** 排序权重（拖动或新建时间） */
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** 输入校验后用于创建的载荷 */
export type OtpAccountDraft = Omit<
  OtpAccount,
  'id' | 'order' | 'createdAt' | 'updatedAt'
> & { id?: string };

export function createAccountFromDraft(draft: OtpAccountDraft, order: number): OtpAccount {
  const now = Date.now();
  return {
    ...draft,
    id: draft.id ?? crypto.randomUUID(),
    order,
    createdAt: now,
    updatedAt: now,
  };
}

/** 依据类型规格修正字段（强制固定算法/位数等）。 */
export function normalizeByType(draft: OtpAccountDraft): OtpAccountDraft {
  const spec = OTP_TYPE_SPECS[draft.type];
  const next = { ...draft };
  if (spec.algorithmFixed) next.algorithm = spec.algorithmFixed;
  if (spec.digitsFixed !== null) next.digits = spec.digitsFixed;
  if (spec.type === 'hotp') next.period = 30;
  if (spec.type !== 'hotp') next.counter = 0;
  if (!spec.requiresPin) delete next.pin;
  return next;
}
