import { describe, expect, test } from "vitest";

import {
  EMPTY_GRPC_WEB_UNARY,
  concatenateFrames,
  encodeGrpcWebDataFrame,
  encodeGrpcWebTrailerFrame,
  firstDataPayload,
  grpcStatusFrom,
  parseGrpcWebFrames,
} from "./grpc-web";

describe("gRPC-Web framing", () => {
  test("encodes the 5-byte empty unary frame", () => {
    expect(EMPTY_GRPC_WEB_UNARY).toEqual(new Uint8Array([0, 0, 0, 0, 0]));
    expect(encodeGrpcWebDataFrame(new Uint8Array())).toEqual(EMPTY_GRPC_WEB_UNARY);
  });

  test("iterates a data frame followed by trailers", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const bytes = concatenateFrames(
      encodeGrpcWebDataFrame(payload),
      encodeGrpcWebTrailerFrame(0),
    );
    const parsed = parseGrpcWebFrames(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.frames).toHaveLength(2);
    expect(firstDataPayload(parsed.frames)).toEqual(payload);
    expect(grpcStatusFrom(new Headers(), parsed.frames)).toEqual({
      status: 0,
      message: undefined,
    });
  });

  test("reads a trailers-only error and a header grpc-status", () => {
    const trailersOnly = parseGrpcWebFrames(encodeGrpcWebTrailerFrame(5, "not found"));
    expect(trailersOnly.ok).toBe(true);
    if (trailersOnly.ok) {
      expect(firstDataPayload(trailersOnly.frames)).toBeUndefined();
      expect(grpcStatusFrom(new Headers(), trailersOnly.frames)).toEqual({
        status: 5,
        message: "not found",
      });
    }

    const headerStatus = grpcStatusFrom(
      new Headers({ "grpc-status": "2", "grpc-message": "unknown" }),
      [],
    );
    expect(headerStatus).toEqual({ status: 2, message: "unknown" });
  });

  test("rejects a compressed frame", () => {
    const bytes = new Uint8Array([1, 0, 0, 0, 0]);
    expect(parseGrpcWebFrames(bytes)).toEqual({
      ok: false,
      message: "Grok usage-pool gRPC-Web frame is compressed.",
    });
  });
});
