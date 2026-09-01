import { defineChain } from 'viem';

/** No endpoint other than the public RPC is used. */
export const RPC_URL = 'https://henesys-rpc.msu.io';

/** Measured 2026-08-25: chainId 68414 (0x10b3e), average block time 2.08s. */
export const henesys = defineChain({
  id: 68414,
  name: 'Henesys',
  nativeCurrency: { name: 'NXPC', symbol: 'NXPC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    /* Snowtrace runs a per-chain instance for Avalanche L1s; 68414 is Henesys.
       Checked 2026-09-01: its API returns the same balances this page reads
       (Fusion reserve cold 83,883,803 / hot 6,316,892). The bare snowtrace.io is
       C-Chain and does not resolve these addresses. */
    default: { name: 'Snowtrace', url: 'https://68414.snowtrace.io' },
    msu: { name: 'MSU Explorer', url: 'https://msu-explorer.xangle.io' },
  },
  contracts: {
    // Read-only Multicall3. aggregate3 packs up to 400 calls into a single eth_call.
    multicall3: { address: '0x99423C88EB5723A590b4C644426069042f137B9e' },
  },
});

/**
 * JSON-RPC batch limit — from 11 requests on, it returns HTTP 500 "too many requests" as plain text.
 * Multicall3 does not run into this limit, but it must be respected when batching
 * calls that cannot go through multicall (eth_getBlockByNumber and the like).
 */
/** Block explorer link for a Henesys address. */
export const explorerAddress = (address: string) =>
  `${henesys.blockExplorers.default.url}/address/${address}`;

export const MAX_RPC_BATCH = 10;

/** Upper bound for a single aggregate3 call. 100 is the balance point between latency and response size. */
export const MULTICALL_CHUNK = 100;
