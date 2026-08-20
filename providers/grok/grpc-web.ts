export const GRPC_WEB_CONTENT_TYPE = "application/grpc-web+proto";

// Empty unary: compression flag 0x00 + big-endian length 0.
export const EMPTY_GRPC_WEB_UNARY = new Uint8Array([0, 0, 0, 0, 0]);

const DATA_FLAG = 0x00;
const TRAILER_FLAG = 0x80;
const COMPRESSED_FLAG = 0x01;

export type GrpcWebFrame =
  | { kind: "data"; payload: Uint8Array }
  | { kind: "trailers"; headers: Map<string, string> };

export function encodeGrpcWebDataFrame(payload: Uint8Array): Uint8Array {
  return encodeFrame(DATA_FLAG, payload);
}

export function encodeGrpcWebTrailerFrame(
  status: number,
  message = "",
): Uint8Array {
  const lines = [`grpc-status: ${status}`];
  if (message) {
    lines.push(`grpc-message: ${message}`);
  }
  lines.push("");
  return encodeFrame(TRAILER_FLAG, new TextEncoder().encode(`${lines.join("\r\n")}\r\n`));
}

export function concatenateFrames(...frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.byteLength;
  }
  return out;
}

export function parseGrpcWebFrames(bytes: Uint8Array):
  | { ok: true; frames: GrpcWebFrame[] }
  | { ok: false; message: string } {
  const frames: GrpcWebFrame[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 5) {
      return { ok: false, message: "Grok usage-pool gRPC-Web frame is truncated." };
    }
    const flag = bytes[offset]!;
    const length =
      ((bytes[offset + 1]! << 24) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! << 8) |
        bytes[offset + 4]!) >>>
      0;
    offset += 5;
    if (offset + length > bytes.byteLength) {
      return { ok: false, message: "Grok usage-pool gRPC-Web frame is truncated." };
    }
    const payload = bytes.subarray(offset, offset + length);
    offset += length;
    if ((flag & COMPRESSED_FLAG) === COMPRESSED_FLAG) {
      return {
        ok: false,
        message: "Grok usage-pool gRPC-Web frame is compressed.",
      };
    }
    if ((flag & TRAILER_FLAG) === TRAILER_FLAG) {
      frames.push({ kind: "trailers", headers: parseTrailerBlock(payload) });
      continue;
    }
    if (flag !== DATA_FLAG) {
      return {
        ok: false,
        message: `Grok usage-pool gRPC-Web frame has unsupported flag ${flag}.`,
      };
    }
    frames.push({ kind: "data", payload });
  }
  return { ok: true, frames };
}

export function grpcStatusFrom(
  headers: Headers,
  frames: readonly GrpcWebFrame[],
): { status: number; message?: string } | undefined {
  const headerStatus = parseStatusValue(headers.get("grpc-status"));
  const headerMessage = headers.get("grpc-message") ?? undefined;
  if (headerStatus !== undefined) {
    return { status: headerStatus, message: headerMessage };
  }
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame?.kind !== "trailers") {
      continue;
    }
    const status = parseStatusValue(frame.headers.get("grpc-status"));
    if (status === undefined) {
      continue;
    }
    return {
      status,
      message: frame.headers.get("grpc-message") ?? undefined,
    };
  }
  return undefined;
}

export function firstDataPayload(
  frames: readonly GrpcWebFrame[],
): Uint8Array | undefined {
  for (const frame of frames) {
    if (frame.kind === "data") {
      return frame.payload;
    }
  }
  return undefined;
}

function encodeFrame(flag: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.byteLength);
  out[0] = flag;
  const length = payload.byteLength;
  out[1] = (length >>> 24) & 0xff;
  out[2] = (length >>> 16) & 0xff;
  out[3] = (length >>> 8) & 0xff;
  out[4] = length & 0xff;
  out.set(payload, 5);
  return out;
}

function parseTrailerBlock(payload: Uint8Array): Map<string, string> {
  const text = new TextDecoder().decode(payload);
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim().toLowerCase();
    const value = trimmed.slice(separator + 1).trim();
    headers.set(name, value);
  }
  return headers;
}

function parseStatusValue(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
