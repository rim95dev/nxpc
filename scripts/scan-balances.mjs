/**
 * Sweeps the native NXPC balance on henesys for a given list of contracts.
 *
 *   node scripts/scan-balances.mjs
 *
 * Other chains (C_ / BSC_ / MONAD_ prefixes) are excluded — the henesys RPC cannot read them.
 * Reads are bundled through Multicall3 aggregate3, so each chunk goes out as one eth_call.
 */
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { henesys } from "../src/lib/chain.ts";

const RPC = "https://henesys-rpc.msu.io";
const MC = "0x99423C88EB5723A590b4C644426069042f137B9e";
const CHUNK = 100;

const MC_ABI = parseAbi([
  "function getEthBalance(address addr) view returns (uint256)",
]);

const CONTRACTS = {
  AdvisorVestingWallet: "0x59A95Ef49BEF691119008Db202Bf0F8c3b4ec2f5",
  ApproveController: "0xc6F301956f65805521d074228b18E4F5Bb419d7D",
  BridgedERC1155TokenImpl: "0xA2bBDDF22538729f2980988B2AfE7819acba64f0",
  BridgedERC20TokenImpl: "0x9AF079D46498f8dc481386CEF2A74408a691fA7C",
  BridgedERC721TokenImpl: "0xD30E5EE278B03c10EbdB71fbA248BdD302b82A75",
  ColdNXPCRecycleVault: "0x959e7008f257B278A314Ef2208e28200118dA408",
  Collection: "0x779A0708A1B365629b91fC206b1305E74189CCF9",
  Commission: "0xCDe2dE9d407E0a7D07DA78ca96184333d9fDc602",
  CommissionVault: "0x86B62249227ecCae39dfb2f001cB75b6258282B9",
  CommunityAirdropWallet: "0x9525B6da53de6BdDae70F2C56Bbd47CA91406b6b",
  ContractManager: "0x0200000000000000000000000000000000000000",
  ContractOwnerMultisig: "0x3D9C330Ae8764cb674378F50B51bB1fadF3f29B3",
  ContributionRewardDistributionWallet:
    "0xfF8e0E1b645AcD15a93Bdd77AE7Dc203Dc345531",
  ContributionRewardDistributor: "0xeEc5d35E12E5d78CF724350978754b65AE255C33",
  ContributionRewardWallet: "0x164ce897e8f6862bcf3914Ad7aA2472B9154128A",
  CreatorFactory: "0x1eec9e982170faDE7fdef29cd6595942e8D24f8F",
  CreatorImpl: "0xE7B5dC19BB0caA15621F71f378009025cE61c75b",
  CreatorImplV2: "0xE613f633b005e6D59aa85Ba6345D3A1474335EC2",
  CreatorUpgradeableBeacon: "0x54b006753f17055C86E2085437FB262454A531D6",
  CreatorWallet: "0x79a3a495135E3d617D74BB8D960Ef026b1810737",
  DAppRewardAllocationWallet: "0x18DCF168258Bd4794D99992581DD74677d4ff5bF",
  DLTIPMGWallet: "0x8E7533FC6E28a93bC769810fD65ed5FB37Ed7e5e",
  DexCommunityVault: "0x59a662Ed724F19AD019307126CbEBdcF4b57d6B1",
  DexPoolPositionManager: "0x658E287E9C820484f5808f687dC4863B552de37D",
  DexPoolwNXPCUSDT: "0x2b3d28523a4e3852ab436d6b545cac5785f7d90b",
  EcosystemBuilderProgram: "0x5a959a0F0897e3922B75DD4b7c81F9FA829d1528",
  EcosystemExchangeOfferingWallet: "0xACfd5169Ba50a5Fb7b561efA0286A65dE7DFB671",
  EcosystemReserveWallet: "0x87Bba4Aed73216260D15eDa24f6fe83650d0B1e3",
  EventStore: "0xd01507db347213680c4F741854B88c71b337fE74",
  ExchangeShop: "0x561FBafE2164dC8D9c706D711655590c3232f13F",
  FeeManager: "0x0200000000000000000000000000000000000003",
  GasSponsorWallet: "0x2DB1C7440E885A171840F64D63e51f59Ff26eac5",
  HotContractOwnerMultisig: "0x47884c99310F6edeDBFc2a58ff3Aa33cfE70255b",
  HotPlatformFeeWallet: "0x43fF86B251a5Bed5a3B72f03783f74C20E212435",
  HotRevenueWallet: "0x68C322DDba93B8cD7d65B30E34D4f1B705224e58",
  IPMG: "0x09E137512F30e1A489951F8538Ca0967dFd7FDe9",
  ItemIssuance: "0x24F094Fd8951eF776f0234d137FAB4Fe890B0EaE",
  L1DestinationBridge: "0xA8383D51E1962C3f32F9Af27b7612Df8D8857522",
  L1Teller: "0xEbdeB5BdeDd722DD663CD46b30A10361b8d0Aad3",
  LiquidAllocationWallet: "0x60054642ca6f4df92d8eA9C67c400638944367D7",
  LiquidityProvisionWallet: "0xD1Ef1787497789d71FaaA85947035ED64F3b8Ad6",
  MSUContentsCommission: "0x9F3bD14E5873DD779191F82700BCE9FC61aF7646",
  MaplestoryAsset: "0xe96d4b00256239A645FC6c734C2c22d3a9b88569",
  MaplestoryCharacter: "0xcE8e48Fae05c093a4A1a1F569BDB53313D765937",
  MaplestoryConsume: "0x3413d3B37a05E3c20c8FB93f54d55539966A9997",
  MaplestoryEquip: "0x43DCff2A0cedcd5e10e6f1c18b503498dDCe60d5",
  MaplestoryEquipSBT: "0xd0BCfd3821CAcd73171d34800669554373496CBf",
  Marketplace: "0xF1c82C082AF3de3614771105F01dC419C3163352",
  MarketplaceV2: "0x6813869c3E5deC06e6f88b42D41487dC5D7aBF57",
  Multicall3: "0x99423C88EB5723A590b4C644426069042f137B9e",
  MulticallWallet: "0xA98A65a1c9b993EA330e1914aa20DCb18635B6b4",
  NFTVault: "0x6E8605cE3b2C530A7eb3632cFf1E1886e0F55ee7",
  NUCIPMGWallet: "0x9F98cfa105f04Ad42FA517d63bBeed4ff892554F",
  NXPCAmountManager: "0x3B25937A9E7EEe347bCbf02Ecfe73416c2ce192a",
  NXPCClaim: "0xa8baad3115A133B101EF935Cb2e198FD04F1C659",
  NXPCDistributor: "0x8ea5DE940fDFFd29f953746d596b8B55aFa03E54",
  NXPCRecycleVault: "0xA5489F2739Bd8E447f768EDeFAb032dD8466B428",
  NextForwarder: "0x08C2CB00d04B28348a62D83A764021975ea76659",
  NextMeso: "0x07E49Ad54FcD23F6e7B911C2068F0148d1827c08",
  OrderBook: "0xDF6D3658335A6608c8C76470B53250add03bcc77",
  PenaltyReserveWallet: "0x3c14868840Ad459bA569110B4F67b480a74F8B23",
  PlatformFeeWallet: "0x9Af1ebEA502eB5743e4a45d702dc56Ddf8149731",
  Raffle: "0xC38e07D32bC493C094F072A0fA5329EDBa21d3c9",
  RandomSeedGenerator: "0x9ffe6B5af651716154B2F78abe5586e7f3D7a26A",
  RevenueWallet: "0x40328F0fe525230666A04fcAC1f512f2b6F08eFa",
  RewardManager: "0x0200000000000000000000000000000000000004",
  SourceBridge: "0x59211b32AC0bFC2cdD67ee1Cb89979D2d33E74C8",
  TEST: "0x9ff23a5587d483013Af9A3F313b2447a5CE6D0D2",
  TeamVestingWallet: "0xdA24fEf18739a118e0BE6519EC83acA71C977b34",
  TeleporterMessenger: "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf",
  Teller: "0x63Cf225d9715A4982B6ad0625b913cD181396f33",
  TestColdWalletMultisig: "0x610cabB17507cc65572612364F919aF66c992c49",
  TrashCan: "0xf0AF2cFBB53F3a017964146663bc9c571798f615",
  Treasury: "0xcCB08010676cb69B70fcaD5e3F49848EF2410aE8",
  USDT: "0xa75aaE282802aDD5BfaE39bC5fE0d4D27b117d0A",
  VRFCoordinator: "0x51fEDe228AcA66ABE237AABF891EA355A7E09140",
  VRFManager: "0xEe5f1056eb57f2B0d2584ADCe40A69F8Ad728F54",
  WarpFeeWallet: "0x009944D77720BFd667D42cd24bB3fe17323930Ab",
  wNXPC: "0x150869eac5C58d3655f860C4316107fB626244d0",
  // Outside the list, but addresses that have to be looked at alongside it
  "BurnAddress(dEaD)": "0x000000000000000000000000000000000000dEaD",
  ZeroAddress: "0x0000000000000000000000000000000000000000",
};

const OTHER_CHAIN = /^(C_|BSC_|MONAD_)/;

const client = createPublicClient({
  chain: henesys,
  transport: http(RPC, { batch: false, timeout: 30_000, retryCount: 2 }),
});

// One address can carry several names (e.g. MulticallWallet / C_MulticallWallet)
const byAddress = new Map();
for (const [name, addr] of Object.entries(CONTRACTS)) {
  const key = addr.toLowerCase();
  const skip = OTHER_CHAIN.test(name);
  const cur = byAddress.get(key) ?? {
    address: addr,
    names: [],
    onlyOtherChain: true,
  };
  cur.names.push(name);
  if (!skip) cur.onlyOtherChain = false;
  byAddress.set(key, cur);
}

// Addresses carrying only other-chain names are excluded
const targets = [...byAddress.values()].filter((e) => !e.onlyOtherChain);

const results = [];
for (let i = 0; i < targets.length; i += CHUNK) {
  const part = targets.slice(i, i + CHUNK);
  const res = await client.multicall({
    contracts: part.map((t) => ({
      address: MC,
      abi: MC_ABI,
      functionName: "getEthBalance",
      args: [t.address],
    })),
    allowFailure: true,
    batchSize: 0,
  });
  part.forEach((t, k) => {
    const r = res[k];
    results.push({
      ...t,
      wei: r?.status === "success" ? r.result : null,
      nxpc: r?.status === "success" ? Number(formatUnits(r.result, 18)) : null,
    });
  });
}

const block = await client.getBlockNumber();
const held = results
  .filter((r) => r.nxpc && r.nxpc > 0)
  .sort((a, b) => b.nxpc - a.nxpc);
const zero = results.filter((r) => r.nxpc === 0);
const failed = results.filter((r) => r.nxpc === null);

const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

console.log(
  `block #${block}   ${targets.length} targets (duplicates and other chains excluded)\n`,
);
console.log("=== addresses holding a balance ===");
for (const r of held) {
  console.log(
    `${fmt(r.nxpc).padStart(20)}  ${r.address}  ${r.names.join(" / ")}`,
  );
}
console.log(`\nzero balance: ${zero.length}   failed reads: ${failed.length}`);
if (failed.length)
  console.log("failed:", failed.map((f) => f.names[0]).join(", "));

console.log(`\ntotal held: ${fmt(held.reduce((n, r) => n + r.nxpc, 0))} NXPC`);

// Also leave it in a machine-readable form
const { writeFileSync } = await import("node:fs");
writeFileSync(
  new URL("../scan-result.json", import.meta.url),
  JSON.stringify(
    {
      block: Number(block),
      scannedAt: Date.now(),
      held: held.map((h) => ({
        address: h.address,
        names: h.names,
        nxpc: h.nxpc,
      })),
    },
    null,
    2,
  ) + "\n",
);
