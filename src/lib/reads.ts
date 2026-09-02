import { createPublicClient, encodeFunctionData, http, parseAbi, formatUnits } from 'viem';
import { avalanche, henesys, AVAX_RPC, C_NXPC, RPC_URL, MULTICALL_CHUNK } from './chain';
import { AVAX_CCIP_POOL } from './chains';
import { WALLETS, READABLE } from './wallets';
import type { LiveSpec } from './live';

const client = createPublicClient({
  chain: henesys,
  transport: http(RPC_URL, { batch: false, retryCount: 2, timeout: 20_000 }),
});

/** Multicall3's built-in view helpers. They let native balances ride along in the multicall too. */
const MULTICALL3_ABI = parseAbi([
  'function getEthBalance(address addr) view returns (uint256)',
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
]);

const MC = henesys.contracts.multicall3.address;
/** Second client, address tab only. See the note on AVAX_RPC. */
const avaxClient = createPublicClient({ chain: avalanche, transport: http(AVAX_RPC, { batch: false }) });
const AVAX_MC = avalanche.contracts.multicall3.address;

/** aggregate3's own signature. viem uses it internally; encoding calldata by hand needs it spelled out. */
const AGGREGATE3_ABI = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
  'struct Result { bool success; bytes returnData; }',
]);


export type ReadSpec =
  | { key: string; kind: 'native'; address: `0x${string}` }
  | {
      key: string;
      kind: 'call';
      address: `0x${string}`;
      abi: readonly unknown[];
      fn: string;
      args?: readonly unknown[];
    };

/**
 * Read specs — this single array builds both the multicall calldata and the screen items.
 * To add a metric, put one line in here.
 *
 * ERC-20 / ERC-721 info gets attached to this array later as kind:'call'. Example:
 *   { key:'mse-supply', kind:'call', address: MSE, abi: ERC721_ABI, fn:'totalSupply' }
 * Mixing kinds is safe — aggregate3's allowFailure isolates each entry
 * (ask an ERC-721 for decimals() and only that entry fails).
 */
/* static aggregate entries (address not disclosed) are not read. Entries that split the
   same address by share could each be read, but to save calls we read once and multiply later. */
export const READS: ReadSpec[] = [
  ...new Map(
    READABLE.map((w) => [
      w.address.toLowerCase(),
      { key: w.address.toLowerCase(), kind: 'native' as const, address: w.address as `0x${string}` },
    ]),
  ).values(),
];

/**
 * Spreads per-address balances out into per-registry-entry values.
 * Multiplies by the share, and fills aggregate entries that have no address with the document value.
 */
export function spread(byAddress: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of WALLETS) {
    if (w.static !== undefined) { out[w.id] = w.static; continue; }
    const raw = byAddress[w.address!.toLowerCase()] ?? 0;
    out[w.id] = raw * (w.share ?? 1);
  }
  return out;
}

export interface Head {
  chainId: number;
  blockNumber: number;
  timestamp: number;
}

export interface Snapshot {
  takenAt: number;
  head: Head;
  /** key → number in NXPC units. Keys whose read failed do not appear here. */
  balances: Record<string, number>;
  failures: string[];
  /** Whether the RPC was actually read. false means this is the archive fallback. */
  fromChain: boolean;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Reads the chain head only. Used by pages that do not need balances. */
/**
 * The aggregate3 calldata the browser reposts on every load.
 *
 * Encoded here, at build time, because it is the same bytes for every visitor —
 * shipping the string instead of an ABI coder keeps viem out of the client
 * bundle. The head calls are appended last so the client can find them by
 * position; readLive() relies on that order.
 */
export function liveSpec(): LiveSpec {
  const calls = [
    ...READABLE.map((w) => ({
      target: MC,
      allowFailure: true,
      callData: encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'getEthBalance',
        args: [w.address as `0x${string}`],
      }),
    })),
    ...(['getBlockNumber', 'getCurrentBlockTimestamp'] as const).map((fn) => ({
      target: MC,
      allowFailure: true,
      callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: fn }),
    })),
  ];

  return {
    rpc: RPC_URL,
    to: MC,
    data: encodeFunctionData({ abi: AGGREGATE3_ABI, functionName: 'aggregate3', args: [calls] }),
    ids: READABLE.map((w) => w.id),
  };
}

/**
 * The address-tab counterpart of liveSpec(): native balances for the Henesys rows.
 *
 * C-Chain rows are left out — reading them needs a second RPC, and the page uses one.
 * Same shape as liveSpec, so the client decodes both with the same function.
 */
/**
 * The C-Chain half of the address tab's live read.
 *
 * Calls balanceOf on the NXPC ERC-20 rather than getEthBalance — on C-Chain, NXPC is
 * a token, so an account's NXPC is not its account balance. Shape matches liveSpec so
 * the client decodes both with the same function.
 */
/**
 * The C-Chain half of the supply figure.
 *
 * Avalanche circulating supply is not a number anyone has to be told:
 *
 *   totalSupply − CCIP pool − the addresses we operate there
 *
 * The pool backs the wrapped NXPC on BNB and Monad, which those chains report
 * separately, so leaving it in counts that supply twice. Our own C-Chain balances
 * come out for the same reason they do on Henesys — this figure feeds free float,
 * which is what is *not* under issuer control.
 *
 * BNB and Monad stay as surveyed figures; neither is read here.
 */
export function avaxSupplySpec(entries: { id: string; address: string; chain: string }[]): LiveSpec {
  const ours = entries.filter((e) => e.chain === 'c-chain');
  const bal = (addr: string) => ({
    target: C_NXPC,
    allowFailure: true,
    callData: encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [addr as `0x${string}`] }),
  });
  const calls = [
    { target: C_NXPC, allowFailure: true, callData: encodeFunctionData({ abi: ERC20_ABI, functionName: 'totalSupply' }) },
    bal(AVAX_CCIP_POOL),
    ...ours.map((e) => bal(e.address)),
    ...(['getBlockNumber', 'getCurrentBlockTimestamp'] as const).map((fn) => ({
      target: AVAX_MC,
      allowFailure: true,
      callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: fn }),
    })),
  ];
  return {
    rpc: AVAX_RPC,
    to: AVAX_MC,
    data: encodeFunctionData({ abi: AGGREGATE3_ABI, functionName: 'aggregate3', args: [calls] }),
    ids: ['totalSupply', 'pool', ...ours.map((e) => e.id)],
  };
}

export function liveAvaxAddressSpec(entries: { id: string; address: string; chain: string }[]): LiveSpec {
  const rows = entries.filter((e) => e.chain === 'c-chain');
  const calls = [
    ...rows.map((e) => ({
      target: C_NXPC,
      allowFailure: true,
      callData: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [e.address as `0x${string}`],
      }),
    })),
    ...(['getBlockNumber', 'getCurrentBlockTimestamp'] as const).map((fn) => ({
      target: AVAX_MC,
      allowFailure: true,
      callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: fn }),
    })),
  ];
  return {
    rpc: AVAX_RPC,
    to: AVAX_MC,
    data: encodeFunctionData({ abi: AGGREGATE3_ABI, functionName: 'aggregate3', args: [calls] }),
    ids: rows.map((e) => e.id),
  };
}

export function liveAddressSpec(entries: { id: string; address: string; chain: string }[]): LiveSpec {
  const rows = entries.filter((e) => e.chain === 'henesys');
  const calls = [
    ...rows.map((e) => ({
      target: MC,
      allowFailure: true,
      callData: encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'getEthBalance',
        args: [e.address as `0x${string}`],
      }),
    })),
    ...(['getBlockNumber', 'getCurrentBlockTimestamp'] as const).map((fn) => ({
      target: MC,
      allowFailure: true,
      callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: fn }),
    })),
  ];
  return {
    rpc: RPC_URL,
    to: MC,
    data: encodeFunctionData({ abi: AGGREGATE3_ABI, functionName: 'aggregate3', args: [calls] }),
    ids: rows.map((e) => e.id),
  };
}

export async function readHead(): Promise<Head> {
  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: 'latest', includeTransactions: false }),
  ]);
  return {
    chainId,
    blockNumber: Number(block.number),
    timestamp: Number(block.timestamp) * 1000,
  };
}

/**
 * Reads the entire current state.
 *
 * Every read is bundled into Multicall3 aggregate3 and goes out as one eth_call
 * (chunked past 100 entries). It never runs into the JSON-RPC batch limit of 10.
 *
 * eth_call against an address with no code returns success + empty returndata from the EVM.
 * viem treats empty data as a decode failure, so that entry drops into failures —
 * which keeps a typo'd address from silently landing on screen as "balance 0".
 */
export async function readAll(): Promise<Snapshot> {
  const contracts = READS.map((r) =>
    r.kind === 'native'
      ? ({ address: MC, abi: MULTICALL3_ABI, functionName: 'getEthBalance', args: [r.address] } as const)
      : ({ address: r.address, abi: r.abi as never, functionName: r.fn, args: r.args ?? [] } as const),
  );

  // The specs are heterogeneous (native / arbitrary contract), so viem's tuple inference does not hold.
  // The return shape is fixed by allowFailure:true, so we spell it out here.
  type MulticallEntry =
    | { status: 'success'; result: unknown }
    | { status: 'failure'; error: unknown };

  const results: MulticallEntry[] = [];
  for (const part of chunk(contracts, MULTICALL_CHUNK)) {
    const res = (await client.multicall({
      contracts: part as never,
      allowFailure: true,
      batchSize: 0, // turn off viem's own chunking and send it as a single aggregate3
    })) as unknown as MulticallEntry[];
    results.push(...res);
  }

  const balances: Record<string, number> = {};
  const failures: string[] = [];

  READS.forEach((spec, i) => {
    const r = results[i];
    if (r?.status !== 'success' || r.result === undefined) {
      failures.push(spec.key);
      return;
    }
    balances[spec.key] =
      spec.kind === 'native'
        ? Number(formatUnits(r.result as bigint, 18))
        : Number(r.result as bigint);
  });

  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: 'latest', includeTransactions: false }),
  ]);

  return {
    takenAt: Date.now(),
    head: {
      chainId,
      blockNumber: Number(block.number),
      timestamp: Number(block.timestamp) * 1000,
    },
    // spread the balances collected under address keys out into registry entry keys (applying share and document values)
    balances: spread(balances),
    failures,
    fromChain: true,
  };
}

/* ------------------------------------------------------------------ *
 * Managed address registry reads
 * ------------------------------------------------------------------ */

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);

const ERC721_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
]);

export interface AddressReadResult {
  balances: Record<string, number | null>;
  tokens: Record<string, { name?: string; symbol?: string; decimals?: number; totalSupply?: number }>;
  failures: string[];
}

/**
 * Reads the native balances of the henesys addresses and the token contract metadata in one shot.
 *
 * It all goes out as one aggregate3 batch — even with native balances and ERC-20/721 calls
 * mixed together, allowFailure isolates each entry. Ask an ERC-721 for decimals() and
 * only that entry fails while the rest come back fine (measured 2026-08-25).
 *
 * c-chain addresses are not read here. They would need a different RPC endpoint, which
 * breaks the "use only the public henesys RPC" rule, so they are left as null.
 */
export async function readAddresses(
  entries: {
    id: string;
    address: string;
    chain: 'henesys' | 'c-chain';
    type: 'contract' | 'eoa';
    standard?: 'erc20' | 'erc721';
  }[],
): Promise<AddressReadResult> {
  type TokenField = 'name' | 'symbol' | 'decimals' | 'totalSupply';
  type Job =
    | { kind: 'native'; id: string }
    | { kind: 'token'; id: string; field: TokenField };

  const jobs: Job[] = [];
  const contracts: unknown[] = [];

  /* C-Chain rows read the NXPC ERC-20 instead of a native balance, through their
     own client and their own multicall. Kept in a separate pass so a failure on one
     chain cannot take the other's balances down with it. */
  const onAvax = entries.filter((e) => e.chain === 'c-chain');

  for (const e of entries) {
    if (e.chain !== 'henesys') continue;

    jobs.push({ kind: 'native', id: e.id });
    contracts.push({
      address: MC, abi: MULTICALL3_ABI, functionName: 'getEthBalance',
      args: [e.address as `0x${string}`],
    });

    if (!e.standard) continue;
    const abi = e.standard === 'erc20' ? ERC20_ABI : ERC721_ABI;
    const fields: TokenField[] =
      e.standard === 'erc20'
        ? ['name', 'symbol', 'decimals', 'totalSupply']
        : ['name', 'symbol', 'totalSupply'];
    for (const field of fields) {
      jobs.push({ kind: 'token', id: e.id, field });
      contracts.push({ address: e.address as `0x${string}`, abi, functionName: field, args: [] });
    }
  }

  const balances: Record<string, number | null> = {};
  const tokens: AddressReadResult['tokens'] = {};
  /**
   * Balances only.
   *
   * A balance that did not come back leaves a hole in the total, so it is worth
   * saying so on the page. Token metadata is decoration: plenty of perfectly
   * healthy contracts do not implement every field — a non-enumerable ERC-721 has
   * no totalSupply, an ERC-1155 has neither name nor symbol. Listing those as
   * «read failed» reports a fault that does not exist, and buries the balance
   * failures that do matter.
   */
  const failures: string[] = [];
  // null means "not read" — it has to stay distinct from 0 or the totals lie.
  for (const e of entries) balances[e.id] = null;

  // ERC-20 totalSupply is a raw uint256, so it has to be divided by decimals.
  // Collect the raw values separately and convert once decimals is settled — so we do not depend on response order.
  const rawSupply = new Map<string, bigint>();
  const isErc20 = new Map(entries.map((e) => [e.id, e.standard === 'erc20']));

  /* C-Chain pass. One aggregate3 for the NXPC balances, plus the token metadata for
     any C-Chain token row. Wrapped so an outage there leaves the Henesys numbers alone. */
  if (onAvax.length) {
    try {
      const calls = onAvax.map((e) => ({
        address: C_NXPC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf' as const,
        args: [e.address as `0x${string}`],
      }));
      const meta = onAvax
        .filter((e) => e.standard)
        .flatMap((e) =>
          (e.standard === 'erc20'
            ? (['name', 'symbol', 'decimals', 'totalSupply'] as const)
            : (['name', 'symbol', 'totalSupply'] as const)
          ).map((field) => ({ id: e.id, field, address: e.address, standard: e.standard! })),
        );
      const res = (await avaxClient.multicall({
        contracts: [
          ...calls,
          ...meta.map((m) => ({
            address: m.address as `0x${string}`,
            abi: (m.standard === 'erc20' ? ERC20_ABI : ERC721_ABI) as never,
            functionName: m.field,
            args: [],
          })),
        ] as never,
        allowFailure: true,
        multicallAddress: AVAX_MC,
      })) as { status: 'success' | 'failure'; result?: unknown }[];
      onAvax.forEach((e, i) => {
        const r = res[i]!;
        if (r.status === 'success') balances[e.id] = Number(formatUnits(r.result as bigint, 18));
        else failures.push(`${e.id}.balance`);
      });
      meta.forEach((m, i) => {
        const r = res[onAvax.length + i]!;
        // A missing field is not a failure — see the note above `failures`.
        if (r.status !== 'success') return;
        const t = (tokens[m.id] ??= {});
        if (m.field === 'name') t.name = r.result as string;
        else if (m.field === 'symbol') t.symbol = r.result as string;
        else if (m.field === 'decimals') t.decimals = Number(r.result);
        else rawSupply.set(m.id, r.result as bigint);
      });
    } catch (err) {
      failures.push(`c-chain: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!jobs.length) return { balances, tokens, failures };

  type Entry = { status: 'success'; result: unknown } | { status: 'failure'; error: unknown };
  const results: Entry[] = [];
  for (const part of chunk(contracts, MULTICALL_CHUNK)) {
    const res = (await client.multicall({
      contracts: part as never, allowFailure: true, batchSize: 0,
    })) as unknown as Entry[];
    results.push(...res);
  }

  jobs.forEach((job, i) => {
    const r = results[i];
    if (r?.status !== 'success' || r.result === undefined) {
      if (job.kind === 'native') failures.push(job.id);
      return;
    }
    if (job.kind === 'native') {
      balances[job.id] = Number(formatUnits(r.result as bigint, 18));
      return;
    }
    const t = (tokens[job.id] ??= {});
    if (job.field === 'name' || job.field === 'symbol') t[job.field] = String(r.result);
    else if (job.field === 'decimals') t.decimals = Number(r.result);
    else rawSupply.set(job.id, r.result as bigint);
  });

  for (const [id, raw] of rawSupply) {
    const t = (tokens[id] ??= {});
    // An ERC-721's totalSupply is a count, so leave it alone. Only ERC-20 is converted by decimals.
    t.totalSupply = isErc20.get(id)
      ? Number(formatUnits(raw, t.decimals ?? 18))
      : Number(raw);
  }

  return { balances, tokens, failures };
}
