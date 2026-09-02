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
    /* The explorer instance for this chain — 68414 is Henesys. Checked 2026-09-01:
       its API returns the same balances this page reads. The bare snowtrace.io is
       C-Chain and does not resolve these addresses. */
    default: { name: 'Snowtrace', url: 'https://68414.snowtrace.io' },
  },
  contracts: {
    // Read-only Multicall3. aggregate3 packs up to 400 calls into a single eth_call.
    multicall3: { address: '0x99423C88EB5723A590b4C644426069042f137B9e' },
  },
});

/**
 * Avalanche C-Chain, for the managed-address tab only.
 *
 * `api.avax.network` is Ava Labs' own public API node — the endpoint their docs
 * hand out — and it answers browser requests: the preflight echoes the caller's
 * origin (checked 2026-09-02 for both the deployed site and localhost).
 *
 * The supply figures do **not** come from here. Off-Henesys amounts stay as the
 * surveyed numbers in chains.yaml, so this endpoint going down can cost the
 * address tab its C-Chain balances and nothing else.
 */
export const AVAX_RPC = 'https://api.avax.network/ext/bc/C/rpc';

export const avalanche = defineChain({
  id: 43114,
  name: 'Avalanche C-Chain',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [AVAX_RPC] } },
  blockExplorers: { default: { name: 'Snowtrace', url: 'https://snowtrace.io' } },
  contracts: {
    // Multicall3's canonical address, the same on every chain that has it.
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});

/**
 * NXPC on C-Chain is an ERC-20, not the native coin, so a C-Chain address holds
 * it through balanceOf rather than in its account balance. That is what the
 * balance column shows there — AVAX would be a different unit in the same column.
 */
export const C_NXPC = '0x5E0E90E268BC247Cc850c789A0DB0d5c7621fb59' as const;

/** Block explorer link for a C-Chain address. */
export const avaxExplorerAddress = (address: string) =>
  `${avalanche.blockExplorers.default.url}/address/${address}`;

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
