/* ------------------------------------------------------------------ *
 * Live balance read, straight from the browser.
 *
 * The figures on the page are baked at build time — that is what makes them
 * survive `curl` and a reader with JavaScript off, and it stays the source of
 * truth. This module is the layer on top: one request on load that replaces the
 * baked numbers with what the chain says right now, or leaves them alone if it
 * cannot.
 *
 * Two things keep the cost at «one request per visitor», the same as the
 * freshness check it replaces:
 *
 *   · Multicall3 aggregate3 packs every wallet into a single eth_call. The
 *     registry can grow without the request count moving — only the payload.
 *     Measured 2026-09-02: 30 wallets, 13.4 KB up, 9.5 KB down, 215 ms median.
 *   · getBlockNumber and getCurrentBlockTimestamp ride along in the same call,
 *     so the head does not need a request of its own.
 *
 * NXPC is the native gas token and has no contract, so balances are read through
 * Multicall3's own getEthBalance helper: the call targets Multicall3, not the
 * wallet, and inside it reads `addr.balance` from EVM state. Verified against
 * eth_getBalance at a pinned block — the two agree exactly.
 *
 * The calldata is identical for every visitor, so it is encoded once at build
 * time and shipped as a string. Decoding is done by hand here rather than with
 * viem: the client would otherwise carry an ABI coder for one fixed-shape
 * response.
 * ------------------------------------------------------------------ */

/** What the server hands the client to make the call with. */
export interface LiveSpec {
  rpc: string;
  /** Multicall3. */
  to: string;
  /** aggregate3 calldata, already encoded. */
  data: string;
  /** Registry ids, in the order their balances come back. */
  ids: string[];
}

export interface LiveRead {
  balances: Record<string, number>;
  blockNumber: number;
  /** Milliseconds, to match Head.timestamp. */
  timestamp: number;
}

const WORD = 64; // 32 bytes as hex characters

const wordAt = (hex: string, byteOffset: number) =>
  BigInt(`0x${hex.slice(byteOffset * 2, byteOffset * 2 + WORD)}`);

/**
 * aggregate3 returns `(bool success, bytes returnData)[]`.
 *
 * A dynamic array of structs that themselves hold dynamic bytes, so every level
 * is reached through an offset: array offset, then one offset per element, then
 * one more to the bytes inside each element. Walking it by hand is only safe
 * because the shape is fixed — every entry here returns a single uint256.
 */
export function decodeAggregate3(result: string): { success: boolean; word: bigint }[] {
  const hex = result.startsWith('0x') ? result.slice(2) : result;
  const arrAt = Number(wordAt(hex, 0));
  const n = Number(wordAt(hex, arrAt));
  const base = arrAt + 32; // past the length word
  const out: { success: boolean; word: bigint }[] = [];

  for (let i = 0; i < n; i++) {
    const tuple = base + Number(wordAt(hex, base + i * 32));
    const success = wordAt(hex, tuple) !== 0n;
    const bytesAt = tuple + Number(wordAt(hex, tuple + 32));
    const len = Number(wordAt(hex, bytesAt));
    // A failed call returns empty data; treat it as no value rather than zero.
    out.push({ success: success && len === 32, word: len === 32 ? wordAt(hex, bytesAt + 32) : 0n });
  }
  return out;
}

/** Wei to NXPC. The registry works in whole tokens, as the baked figures do. */
const toNxpc = (wei: bigint) => Number(wei) / 1e18;

/**
 * One request, every balance plus the chain head.
 *
 * Throws on anything unexpected — a transport error, an RPC error, a short
 * response, or a single failed entry. A partial read is the dangerous case: a
 * missing balance reads as zero and inflates circulating supply, so the caller
 * is meant to keep the baked figures instead of showing a number that is wrong
 * in the safe-looking direction.
 */
export async function readLive(spec: LiveSpec, signal?: AbortSignal): Promise<LiveRead> {
  const res = await fetch(spec.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: spec.to, data: spec.data }, 'latest'],
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);

  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'RPC error');
  if (!json.result) throw new Error('empty result');

  const words = decodeAggregate3(json.result);
  // The two head values are appended after the balances by liveSpec().
  if (words.length !== spec.ids.length + 2) {
    throw new Error(`expected ${spec.ids.length + 2} results, got ${words.length}`);
  }
  const failed = words.filter((w) => !w.success).length;
  if (failed) throw new Error(`${failed} of ${words.length} calls failed`);

  const balances: Record<string, number> = {};
  spec.ids.forEach((id, i) => { balances[id] = toNxpc(words[i]!.word); });

  return {
    balances,
    blockNumber: Number(words[spec.ids.length]!.word),
    timestamp: Number(words[spec.ids.length + 1]!.word) * 1000,
  };
}
