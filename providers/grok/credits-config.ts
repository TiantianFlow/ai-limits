// Field numbers from grok_build_billing.proto FileDescriptorProto
// (prod/grok/backend/proto/grok_build_billing.proto, package grok_api_v2),
// decoded from grok.com's fileDesc — not inferred from field order.
//
// GetGrokCreditsConfigResponse:
//   1 config = GrokCreditsConfig
// GrokCreditsConfig:
//   1 credit_usage_percent = float
//   2 on_demand_cap = Cent          // money — skipped, never stored
//   3 on_demand_used = Cent         // money — skipped, never stored
//   4 billing_period_start = Timestamp
//   5 billing_period_end = Timestamp
//   6 history = PeriodUsage
//   7 product_usage = ProductUsage (repeated)
//   8 current_period = UsagePeriod
//  11 is_unified_billing_user = bool
//  12 prepaid_balance = Cent        // Extra usage credits; Cent.val is field 1, TYPE_INT64, cents
//  13 top_up_method = TopUpMethod
// prod_charger.Cent (prod/charger-proto/proto/types.proto):
//   1 val = int64
// UsagePeriod:
//   1 type = UsagePeriodType (0 unspecified, 1 monthly, 2 weekly)
//   2 start = google.protobuf.Timestamp
//   3 end = google.protobuf.Timestamp
// ProductUsage:
//   1 product = billing_product.Product (2 GROK_BUILD, 4 GROK_CHAT)
//   2 usage_percent = float
// google.protobuf.Timestamp:
//   1 seconds = int64
//   2 nanos = int32

export const PRODUCT_GROK_BUILD = 2;
export const PRODUCT_GROK_CHAT = 4;
export const USAGE_PERIOD_MONTHLY = 1;
export const USAGE_PERIOD_WEEKLY = 2;

export interface DecodedProductUsage {
  product: number;
  usagePercent: number;
}

export interface DecodedCreditsConfig {
  creditUsagePercent?: number;
  isUnifiedBillingUser?: boolean;
  billingFlagPresent: boolean;
  currentPeriodType?: number;
  currentPeriodStartMs?: number;
  currentPeriodEndMs?: number;
  prepaidBalanceCents?: number;
  productUsage: DecodedProductUsage[];
}

export type CreditsDecodeResult =
  | { ok: true; config: DecodedCreditsConfig }
  | { ok: false; message: string };

export function decodeGrokCreditsConfigResponse(
  bytes: Uint8Array,
): CreditsDecodeResult {
  let configBytes: Uint8Array | undefined;
  try {
    for (const field of readFields(bytes)) {
      if (field.number === 1 && field.wireType === 2) {
        configBytes = field.bytes;
      }
    }
  } catch {
    return { ok: false, message: "Grok usage-pool protobuf is truncated." };
  }
  if (configBytes === undefined) {
    return { ok: false, message: "Grok usage-pool missing required field: config" };
  }
  return decodeCreditsConfig(configBytes);
}

export function encodeGrokCreditsConfigResponse(
  config: {
    creditUsagePercent?: number;
    isUnifiedBillingUser?: boolean;
    currentPeriodType?: number;
    currentPeriodStartMs?: number;
    currentPeriodEndMs?: number;
    prepaidBalanceCents?: number;
    productUsage?: DecodedProductUsage[];
  },
): Uint8Array {
  return encodeLengthField(1, encodeCreditsConfig(config));
}

function decodeCreditsConfig(bytes: Uint8Array): CreditsDecodeResult {
  const config: DecodedCreditsConfig = {
    billingFlagPresent: false,
    productUsage: [],
  };
  try {
    for (const field of readFields(bytes)) {
      if (field.number === 1 && field.wireType === 5) {
        config.creditUsagePercent = field.float;
        continue;
      }
      if (field.number === 2 || field.number === 3) {
        // on_demand_cap / on_demand_used — money, still excluded.
        continue;
      }
      if (field.number === 12 && field.wireType === 2) {
        const cents = decodeCent(field.bytes);
        if (cents !== undefined) {
          config.prepaidBalanceCents = cents;
        }
        continue;
      }
      if (field.number === 7 && field.wireType === 2) {
        const product = decodeProductUsage(field.bytes);
        if (product) {
          config.productUsage.push(product);
        }
        continue;
      }
      if (field.number === 8 && field.wireType === 2) {
        const period = decodeUsagePeriod(field.bytes);
        if (!period.ok) {
          return period;
        }
        config.currentPeriodType = period.type;
        config.currentPeriodStartMs = period.startMs;
        config.currentPeriodEndMs = period.endMs;
        continue;
      }
      if (field.number === 11 && field.wireType === 0) {
        config.billingFlagPresent = true;
        config.isUnifiedBillingUser = field.varint !== 0;
      }
    }
  } catch {
    return { ok: false, message: "Grok usage-pool protobuf is truncated." };
  }
  return { ok: true, config };
}

function decodeUsagePeriod(bytes: Uint8Array):
  | { ok: true; type?: number; startMs?: number; endMs?: number }
  | { ok: false; message: string } {
  let type: number | undefined;
  let startMs: number | undefined;
  let endMs: number | undefined;
  try {
    for (const field of readFields(bytes)) {
      if (field.number === 1 && field.wireType === 0) {
        type = field.varint;
        continue;
      }
      if (field.number === 2 && field.wireType === 2) {
        startMs = decodeTimestamp(field.bytes);
        if (startMs === undefined) {
          return {
            ok: false,
            message: "Grok usage-pool has invalid field: current_period.start",
          };
        }
        continue;
      }
      if (field.number === 3 && field.wireType === 2) {
        endMs = decodeTimestamp(field.bytes);
        if (endMs === undefined) {
          return {
            ok: false,
            message: "Grok usage-pool has invalid field: current_period.end",
          };
        }
      }
    }
  } catch {
    return { ok: false, message: "Grok usage-pool protobuf is truncated." };
  }
  return { ok: true, type, startMs, endMs };
}

function decodeProductUsage(bytes: Uint8Array): DecodedProductUsage | undefined {
  let product: number | undefined;
  let usagePercent: number | undefined;
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wireType === 0) {
      product = field.varint;
    }
    if (field.number === 2 && field.wireType === 5) {
      usagePercent = field.float;
    }
  }
  if (product === undefined || usagePercent === undefined) {
    return undefined;
  }
  return { product, usagePercent };
}

function decodeTimestamp(bytes: Uint8Array): number | undefined {
  let seconds: number | undefined;
  let nanos = 0;
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wireType === 0) {
      seconds = field.varint;
    }
    if (field.number === 2 && field.wireType === 0) {
      nanos = field.varint;
    }
  }
  if (seconds === undefined || seconds <= 0 || !Number.isFinite(seconds)) {
    return undefined;
  }
  return seconds * 1_000 + Math.floor(nanos / 1e6);
}

function encodeCreditsConfig(config: {
  creditUsagePercent?: number;
  isUnifiedBillingUser?: boolean;
  currentPeriodType?: number;
  currentPeriodStartMs?: number;
  currentPeriodEndMs?: number;
  prepaidBalanceCents?: number;
  productUsage?: DecodedProductUsage[];
}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (config.creditUsagePercent !== undefined) {
    parts.push(encodeFloatField(1, config.creditUsagePercent));
  }
  for (const product of config.productUsage ?? []) {
    parts.push(
      encodeLengthField(
        7,
        concatBytes(
          encodeVarintField(1, product.product),
          encodeFloatField(2, product.usagePercent),
        ),
      ),
    );
  }
  if (
    config.currentPeriodType !== undefined ||
    config.currentPeriodStartMs !== undefined ||
    config.currentPeriodEndMs !== undefined
  ) {
    const period: Uint8Array[] = [];
    if (config.currentPeriodType !== undefined) {
      period.push(encodeVarintField(1, config.currentPeriodType));
    }
    if (config.currentPeriodStartMs !== undefined) {
      period.push(encodeLengthField(2, encodeTimestamp(config.currentPeriodStartMs)));
    }
    if (config.currentPeriodEndMs !== undefined) {
      period.push(encodeLengthField(3, encodeTimestamp(config.currentPeriodEndMs)));
    }
    parts.push(encodeLengthField(8, concatBytes(...period)));
  }
  if (config.isUnifiedBillingUser !== undefined) {
    parts.push(encodeVarintField(11, config.isUnifiedBillingUser ? 1 : 0));
  }
  if (config.prepaidBalanceCents !== undefined) {
    parts.push(encodeLengthField(12, encodeVarintField(1, config.prepaidBalanceCents)));
  }
  return concatBytes(...parts);
}

function decodeCent(bytes: Uint8Array): number | undefined {
  let val: number | undefined;
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wireType === 0) {
      val = field.varint;
    }
  }
  if (
    val === undefined ||
    !Number.isFinite(val) ||
    !Number.isSafeInteger(val) ||
    val < 0
  ) {
    return undefined;
  }
  return val;
}

function encodeTimestamp(ms: number): Uint8Array {
  const seconds = Math.floor(ms / 1_000);
  const nanos = Math.floor((ms % 1_000) * 1e6);
  return concatBytes(encodeVarintField(1, seconds), encodeVarintField(2, nanos));
}

type ProtoField =
  | { number: number; wireType: 0; varint: number }
  | { number: number; wireType: 2; bytes: Uint8Array }
  | { number: number; wireType: 5; float: number }
  | { number: number; wireType: 1 };

function* readFields(bytes: Uint8Array): Generator<ProtoField> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset);
    offset = tag.next;
    const number = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (wireType === 0) {
      const value = readVarint(bytes, offset);
      offset = value.next;
      yield { number, wireType: 0, varint: value.value };
      continue;
    }
    if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.next;
      if (offset + length.value > bytes.byteLength) {
        throw new Error("truncated");
      }
      yield {
        number,
        wireType: 2,
        bytes: bytes.subarray(offset, offset + length.value),
      };
      offset += length.value;
      continue;
    }
    if (wireType === 5) {
      if (offset + 4 > bytes.byteLength) {
        throw new Error("truncated");
      }
      yield {
        number,
        wireType: 5,
        float: new DataView(
          bytes.buffer,
          bytes.byteOffset + offset,
          4,
        ).getFloat32(0, true),
      };
      offset += 4;
      continue;
    }
    if (wireType === 1) {
      if (offset + 8 > bytes.byteLength) {
        throw new Error("truncated");
      }
      offset += 8;
      yield { number, wireType: 1 };
      continue;
    }
    throw new Error("truncated");
  }
}

function readVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  while (offset < bytes.byteLength) {
    const byte = bytes[offset]!;
    offset += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value, next: offset };
    }
    shift += 7;
    if (shift > 53) {
      throw new Error("truncated");
    }
  }
  throw new Error("truncated");
}

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = Math.floor(value);
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Uint8Array.from(bytes);
}

function encodeVarintField(number: number, value: number): Uint8Array {
  return concatBytes(encodeVarint((number << 3) | 0), encodeVarint(value));
}

function encodeFloatField(number: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setFloat32(0, value, true);
  return concatBytes(encodeVarint((number << 3) | 5), payload);
}

function encodeLengthField(number: number, payload: Uint8Array): Uint8Array {
  return concatBytes(
    encodeVarint((number << 3) | 2),
    encodeVarint(payload.byteLength),
    payload,
  );
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
