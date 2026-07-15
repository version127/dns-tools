import dgram from "node:dgram";
import net, { BlockList } from "node:net";
import dnsPacket from "dns-packet";
import { decodeDnsResponse, encodeDnsQuery, type RawDnsWireResponse } from "./dns-wire.ts";
import type { DnsRecordType } from "./types.ts";

const blocked = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");

for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001:db8::", 32], ["2001:10::", 28], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

export function isPublicDnsAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) return !blocked.check(address, "ipv4");
  if (version === 6) return !address.toLowerCase().startsWith("::ffff:") && !blocked.check(address, "ipv6");
  return false;
}

export type AuthoritativeTarget = { zone: string; hostname: string; address: string };
export type DirectDnsTarget = { hostname: string; address: string };

type BootstrapQuery = (name: string, type: DnsRecordType) => Promise<RawDnsWireResponse>;

function parentName(name: string) {
  const labels = name.split(".").filter(Boolean);
  return labels.length > 1 ? labels.slice(1).join(".") : name;
}

function discoveryNames(name: string) {
  const labels = name.split(".").filter(Boolean);
  return Array.from({ length: Math.max(1, labels.length - 1) }, (_, index) => labels.slice(index).join("."));
}

export async function discoverAuthoritativeTarget(
  requestedName: string,
  requestedType: DnsRecordType,
  bootstrapQuery: BootstrapQuery,
): Promise<AuthoritativeTarget> {
  const startName = requestedType === "DS" ? parentName(requestedName) : requestedName;
  for (const zone of discoveryNames(startName)) {
    const nsResponse = await bootstrapQuery(zone, "NS");
    const nameservers = (nsResponse.Answer ?? [])
      .filter((record) => record.type === 2)
      .map((record) => record.data.replace(/\.$/, ""));
    for (const hostname of nameservers) {
      for (const type of ["A", "AAAA"] as const) {
        try {
          const addressResponse = await bootstrapQuery(hostname, type);
          const address = (addressResponse.Answer ?? [])
            .filter((record) => record.type === (type === "A" ? 1 : 28))
            .map((record) => record.data)
            .find(isPublicDnsAddress);
          if (address) return { zone, hostname, address };
        } catch {
          // A nameserver may publish only one address family. Try the other one or the next NS.
        }
      }
    }
  }
  throw new Error("No safe, reachable authoritative nameserver address was found.");
}

function abortError() {
  return new DOMException("The DNS lookup was aborted.", "AbortError");
}

async function udpQuery(packet: Buffer, target: DirectDnsTarget, timeoutMs: number, signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
  const family = net.isIP(target.address) === 6 ? "udp6" : "udp4";
  return new Promise<Buffer>((resolve, reject) => {
    const socket = dgram.createSocket(family);
    let settled = false;
    const finish = (error?: Error, response?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.close();
      if (error) reject(error);
      else resolve(response as Buffer);
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error("The authoritative nameserver timed out.")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("error", (error) => finish(error));
    socket.once("message", (message) => finish(undefined, message));
    socket.send(packet, 53, target.address, (error) => {
      if (error) finish(error);
    });
  });
}

async function tcpQuery(packet: Buffer, target: DirectDnsTarget, timeoutMs: number, signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
  return new Promise<Buffer>((resolve, reject) => {
    const socket = net.createConnection({ host: target.address, port: 53 });
    const chunks: Buffer[] = [];
    let expectedLength: number | null = null;
    let settled = false;
    const finish = (error?: Error, response?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(response as Buffer);
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error("The authoritative nameserver timed out.")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      const data = Buffer.concat(chunks);
      if (expectedLength === null && data.length >= 2) expectedLength = data.readUInt16BE(0);
      if (expectedLength !== null && expectedLength <= 262_144 && data.length >= expectedLength + 2) {
        finish(undefined, data.subarray(2, expectedLength + 2));
      } else if (expectedLength !== null && expectedLength > 262_144) {
        finish(new Error("The authoritative nameserver returned an oversized response."));
      }
    });
    socket.once("connect", () => socket.write(dnsPacket.streamEncode(dnsPacket.decode(packet))));
  });
}

export async function queryDirectDnsServer(
  name: string,
  type: DnsRecordType,
  target: DirectDnsTarget,
  options: { timeoutMs?: number; signal?: AbortSignal; transport?: "auto" | "udp" | "tcp" } = {},
) {
  if (!isPublicDnsAddress(target.address)) throw new Error("The nameserver address is not safe to query.");
  const packet = encodeDnsQuery(name, type, { recursive: false });
  const query = dnsPacket.decode(packet);
  const transport = options.transport ?? "auto";
  let response = transport === "tcp"
    ? await tcpQuery(packet, target, options.timeoutMs ?? 3000, options.signal)
    : await udpQuery(packet, target, options.timeoutMs ?? 3000, options.signal);
  let decoded = dnsPacket.decode(response);
  if (!decoded.flag_qr || decoded.id !== query.id) throw new Error("The authoritative nameserver returned a response that did not match the query.");
  if (decoded.flag_tc && transport === "auto") {
    response = await tcpQuery(packet, target, options.timeoutMs ?? 3000, options.signal);
    decoded = dnsPacket.decode(response);
    if (!decoded.flag_qr || decoded.id !== query.id) throw new Error("The authoritative nameserver returned a response that did not match the query.");
  }
  return decodeDnsResponse(response, [`Response from ${target.hostname} (${target.address}).`]);
}

export async function queryAuthoritative(
  name: string,
  type: DnsRecordType,
  target: AuthoritativeTarget,
  options: { timeoutMs?: number; signal?: AbortSignal; transport?: "auto" | "udp" | "tcp" } = {},
) {
  const response = await queryDirectDnsServer(name, type, target, options);
  if (!response.AA) throw new Error("The selected nameserver did not return an authoritative answer for this name.");
  response.Comment = [`Response from ${target.hostname} (${target.address}) for ${target.zone}.`];
  return response;
}
