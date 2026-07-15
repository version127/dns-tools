export function safeDnsErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/\b(?:ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL|EAFNOSUPPORT|EPROTONOSUPPORT)\b/.test(message)) {
    return "This checker could not reach that address from its network.";
  }
  if (/\bECONNREFUSED\b/.test(message)) return "The nameserver refused the connection.";
  if (/\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|timeout)\b|timed out/i.test(message)) return "The nameserver did not answer before the timeout.";
  if (/oversized response/i.test(message)) return "The DNS server returned a response that was too large to process safely.";
  if (/did not match the query/i.test(message)) return "The DNS server returned a response that did not match the question.";
  if (/not safe to query/i.test(message)) return "The discovered nameserver address is not safe to query.";
  if (error instanceof DOMException && error.name === "AbortError") return "The DNS check was stopped.";
  return fallback;
}
