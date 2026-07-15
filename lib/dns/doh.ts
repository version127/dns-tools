import http2 from "node:http2";
import dnsPacket from "dns-packet";
import { decodeDnsResponse, encodeDnsQuery, type RawDnsWireResponse } from "./dns-wire.ts";
import { resolverProfile } from "./resolvers.ts";
import type { DnsRecordType, DnsResolver } from "./types.ts";

const MAX_RESPONSE_BYTES = 262_144;

async function queryWithHttp2(endpoint: string, packet: Buffer, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("The DNS lookup was aborted.", "AbortError");
  const url = new URL(endpoint);
  return new Promise<{ body: Uint8Array; status: number }>((resolve, reject) => {
    const session = http2.connect(url.origin);
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let status = 0;
    let settled = false;
    const finish = (error?: Error, body?: Uint8Array) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      session.close();
      if (error) reject(error);
      else resolve({ body: body as Uint8Array, status });
    };
    const onAbort = () => {
      session.destroy();
      finish(new DOMException("The DNS lookup was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    session.once("error", (error) => finish(error));
    const request = session.request({
      ":method": "POST",
      ":path": `${url.pathname}${url.search}`,
      accept: "application/dns-message",
      "content-type": "application/dns-message",
      "content-length": String(packet.byteLength),
    });
    request.once("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
      const contentLength = Number(headers["content-length"] ?? 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        request.close();
        finish(new Error("The DNS resolver returned an oversized response."));
      }
    });
    request.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        request.close();
        finish(new Error("The DNS resolver returned an oversized response."));
        return;
      }
      chunks.push(buffer);
    });
    request.once("error", (error) => finish(error));
    request.once("end", () => finish(undefined, Buffer.concat(chunks)));
    request.end(packet);
  });
}

export async function queryPublicResolver(
  name: string,
  type: DnsRecordType,
  resolver: Exclude<DnsResolver, "authoritative">,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RawDnsWireResponse> {
  const profile = resolverProfile(resolver);
  if (!profile.endpoint) throw new Error("This DNS source does not have a public HTTPS endpoint.");
  const packet = encodeDnsQuery(name, type, { recursive: true });
  const query = dnsPacket.decode(packet);
  let responseBody: Uint8Array;
  let responseStatus: number;
  if (profile.transport === "http2" && !options.fetchImpl) {
    const response = await queryWithHttp2(profile.endpoint, packet, options.signal);
    responseBody = response.body;
    responseStatus = response.status;
  } else {
    const body = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength) as ArrayBuffer;
    const response = await (options.fetchImpl ?? fetch)(profile.endpoint, {
      body,
      headers: {
        accept: "application/dns-message",
        "content-type": "application/dns-message",
      },
      method: "POST",
      redirect: "error",
      signal: options.signal,
    });
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("The DNS resolver returned an oversized response.");
    }
    responseBody = new Uint8Array(await response.arrayBuffer());
    responseStatus = response.status;
  }
  if (responseBody.byteLength > MAX_RESPONSE_BYTES) throw new Error("The DNS resolver returned an oversized response.");
  if (responseStatus < 200 || responseStatus >= 300) {
    const error = new Error(`The DNS resolver returned HTTP ${responseStatus}.`) as Error & { status?: number };
    error.status = responseStatus;
    throw error;
  }
  const decoded = dnsPacket.decode(Buffer.from(responseBody));
  if (!decoded.flag_qr || decoded.id !== query.id) throw new Error("The DNS resolver returned a response that did not match the query.");
  return decodeDnsResponse(responseBody);
}
