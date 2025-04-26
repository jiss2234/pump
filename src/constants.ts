import { Connection, Keypair, PublicKey, Commitment } from "@solana/web3.js";
import base58 from "bs58";
import dotenv from "dotenv";

// 加载 .env 文件
dotenv.config();

// 配置校验
const requiredEnvVars = [
  "RPC_ENDPOINT",
  "COMMITMENT_LEVEL",
  "PAYERPRIVATEKEY",
  "QUOTE_MINT",
  "QUOTE_AMOUNT",
  "SLIPPAGE",
  "JITO_FEE",
  "JITO_MODE",
  "TX_NUM",
  "TAKE_PROFIT",
  "STOP_LOSS",
  "HOLD_DURATION",
  "TX_DELAY",
  "TX_FEE",
  "COMPUTE_UNIT",
  "LOG_LEVEL",
  "MAX_CONCURRENT_TOKENS",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} 在 .env 文件中是必需的`);
  }
}

// 解析环境变量
const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || "";
const COMMITMENT_LEVEL = process.env.COMMITMENT_LEVEL! as Commitment;
const PAYER_PRIVATEKEY = process.env.PAYERPRIVATEKEY!;
const QUOTE_MINT = process.env.QUOTE_MINT!;
const quoteAmountRaw = process.env.QUOTE_AMOUNT!;
const quoteAmountParsed = parseFloat(quoteAmountRaw);
if (isNaN(quoteAmountParsed) || quoteAmountParsed <= 0) {
  throw new Error(`QUOTE_AMOUNT 无效: ${quoteAmountRaw}`);
}
const QUOTE_AMOUNT = Math.round(quoteAmountParsed * 10 ** 9); // 统一精度
console.log(`Parsed QUOTE_AMOUNT: ${QUOTE_AMOUNT / 10 ** 9} SOL`); // 调试输出
const SLIPPAGE = parseInt(process.env.SLIPPAGE!);
const JITO_FEE = parseFloat(process.env.JITO_FEE!);
const JITO_MODE = process.env.JITO_MODE!.toLowerCase() === "true";
const TX_NUM = parseInt(process.env.TX_NUM!);
const TAKE_PROFIT = parseInt(process.env.TAKE_PROFIT!);
const STOP_LOSS = parseInt(process.env.STOP_LOSS!);
const HOLD_DURATION = parseInt(process.env.HOLD_DURATION!);
const TX_DELAY = parseInt(process.env.TX_DELAY!);
const TX_FEE = parseFloat(process.env.TX_FEE!);
const COMPUTE_UNIT = parseInt(process.env.COMPUTE_UNIT!);
const LOG_LEVEL = process.env.LOG_LEVEL!;
const CHECK_FILTER = process.env.CHECK_FILTER?.toLowerCase() === "true" || false;
const MAX_CONCURRENT_TOKENS = parseInt(process.env.MAX_CONCURRENT_TOKENS!);
const DEXSCREENER_API = process.env.DEXSCREENER_API!; // 使用 .env 的值

// 严格校验
// PAYERPRIVATEKEY: 必须是有效的 base58 编码，64 字节
let payerKeypair: Keypair;
try {
  const decodedKey = base58.decode(PAYER_PRIVATEKEY);
  if (decodedKey.length !== 64) {
    throw new Error(`PAYERPRIVATEKEY 长度必须为 64 字节，实际为 ${decodedKey.length} 字节`);
  }
  payerKeypair = Keypair.fromSecretKey(decodedKey);
} catch (e: any) {
  throw new Error(`PAYERPRIVATEKEY 格式无效，必须是有效的 base58 编码 (64 字节): ${e.message}`);
}

// QUOTE_MINT: 当前仅支持 SOL
if (QUOTE_MINT !== "SOL") {
  throw new Error("QUOTE_MINT 当前仅支持 SOL");
}

// COMMITMENT_LEVEL: 必须是 processed、confirmed 或 finalized
if (!["processed", "confirmed", "finalized"].includes(COMMITMENT_LEVEL)) {
  throw new Error("COMMITMENT_LEVEL 必须是 processed、confirmed 或 finalized");
}

// 数值字段校验
if (isNaN(QUOTE_AMOUNT) || QUOTE_AMOUNT <= 0) throw new Error("QUOTE_AMOUNT 必须是正数（SOL）");
if (isNaN(SLIPPAGE) || SLIPPAGE < 0 || SLIPPAGE > 100) throw new Error("SLIPPAGE 必须在 0-100 之间");
if (isNaN(JITO_FEE) || JITO_FEE < 0 || JITO_FEE > 0.1) throw new Error("JITO_FEE 必须在 0-0.1 SOL 之间");
if (isNaN(TX_NUM) || TX_NUM <= 0 || TX_NUM > 10) throw new Error("TX_NUM 必须在 1-10 之间");
if (isNaN(TAKE_PROFIT) || TAKE_PROFIT <= 0) throw new Error("TAKE_PROFIT 必须是正数");
if (isNaN(STOP_LOSS) || STOP_LOSS <= 0) throw new Error("STOP_LOSS 必须是正数");
if (isNaN(HOLD_DURATION) || HOLD_DURATION <= 0) throw new Error("HOLD_DURATION 必须是正数（秒）");
if (isNaN(TX_DELAY) || TX_DELAY < 0 || TX_DELAY > 60) throw new Error("TX_DELAY 必须在 0-60 秒之间");
if (isNaN(TX_FEE) || TX_FEE < 0 || TX_FEE > 0.01) throw new Error("TX_FEE 必须在 0-0.01 SOL 之间");
if (isNaN(COMPUTE_UNIT) || COMPUTE_UNIT <= 0 || COMPUTE_UNIT > 1000000) throw new Error("COMPUTE_UNIT 必须在 1-1000000 之间");
if (!["info", "debug", "error"].includes(LOG_LEVEL)) throw new Error("LOG_LEVEL 必须是 info、debug 或 error");
if (isNaN(MAX_CONCURRENT_TOKENS) || MAX_CONCURRENT_TOKENS <= 0 || MAX_CONCURRENT_TOKENS > 10) {
  throw new Error("MAX_CONCURRENT_TOKENS 必须在 1-10 之间");
}

// Jito 提示账户
const JITO_TIP_ACCOUNTS = [
  new PublicKey("HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe"), // Amsterdam
  new PublicKey("Cw8CFyM9FkoMi7K7Cr9B2WarnaF9QvbVgEDjL7VdgZ6t"), // NY
  new PublicKey("ADaUMid9zVhPNutdb59uS5iaUF4XRVcfes9KXoehztPa"), // Tokyo
];

// Pump.fun 指令数据
const BUY_INSTRUCTION = Buffer.from("66063d1201daebea", "hex");
const SELL_INSTRUCTION = Buffer.from("b1d97428d065029b", "hex");

// 过滤参数（恢复导出以支持 tokenfilter.ts）
const CHECK_SOCIAL = false; // CHECK_FILTER=false，未使用
const CHECK_NAMEWHITELIST = false;
const CHECK_NAMEBLACKLIST = false;
const CHECK_WALLETWHITELIST = false;
const CHECK_WALLETBLACKLIST = false;
const CHECK_SOLDBALANCE = false;

// 导出常量
export {
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  COMMITMENT_LEVEL,
  PAYER_PRIVATEKEY,
  QUOTE_MINT,
  QUOTE_AMOUNT,
  SLIPPAGE,
  JITO_FEE,
  JITO_MODE,
  TX_NUM,
  TAKE_PROFIT,
  STOP_LOSS,
  HOLD_DURATION,
  TX_DELAY,
  TX_FEE,
  COMPUTE_UNIT,
  LOG_LEVEL,
  CHECK_FILTER,
  MAX_CONCURRENT_TOKENS,
  DEXSCREENER_API,
  payerKeypair,
  BUY_INSTRUCTION,
  SELL_INSTRUCTION,
  JITO_TIP_ACCOUNTS,
  CHECK_SOCIAL,
  CHECK_NAMEWHITELIST,
  CHECK_NAMEBLACKLIST,
  CHECK_WALLETWHITELIST,
  CHECK_WALLETBLACKLIST,
  CHECK_SOLDBALANCE,
};

export const connection = new Connection(RPC_ENDPOINT, { wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: COMMITMENT_LEVEL });
export const GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
export const FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOC_TOKEN_ACC_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
export const PUMP_FUN_ACCOUNT = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
export const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const MINIMUMTOKENBALANCEPERCENT = 10;