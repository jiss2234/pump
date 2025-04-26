import {
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
  Connection,
  Keypair,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PUMP_FUN_PROGRAM,
  GLOBAL,
  FEE_RECIPIENT,
  SYSTEM_PROGRAM,
  RENT,
  ASSOC_TOKEN_ACC_PROG,
  CHECK_FILTER,
  COMMITMENT_LEVEL,
  connection,
  payerKeypair,
  DEXSCREENER_API,
  JITO_MODE,
  QUOTE_AMOUNT,
  SLIPPAGE,
  JITO_FEE,
  TX_NUM,
  TAKE_PROFIT,
  STOP_LOSS,
  HOLD_DURATION,
  TX_DELAY,
  TX_FEE,
  COMPUTE_UNIT,
  PUMP_FUN_ACCOUNT,
  MAX_CONCURRENT_TOKENS,
} from "./constants";
import { getMintData } from "./tokenFilter";
import { BONDING_CURV } from "./layout";
import { sleep, logger, sendJitoBundle } from "./utility";
import { rl, snipe_menu } from "../index";
import axios from "axios";
import BN from "bn.js";

const TRADE_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const BONDING_ADDR_SEED = new Uint8Array([98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101]);

// 跟踪当前处理的代币
const activeTokens: Set<string> = new Set();
let globalLogListener: number | null = null;

// 使用 PUMP_FUN_ACCOUNT 作为 event_authority
const eventAuthority = PUMP_FUN_ACCOUNT;

interface LogEvent {
  logs: string[];
  err: any;
  signature: string;
}

export const runListener = async () => {
  logger.info("\nTracking new pools on pump.fun...");
  try {
    globalLogListener = connection.onLogs(
      PUMP_FUN_PROGRAM,
      async ({ logs, err, signature }: LogEvent) => {
        const isMint = logs.filter((log: string) => log.includes("MintTo")).length;
        if (isMint && !err) {
          if (activeTokens.size >= MAX_CONCURRENT_TOKENS) {
            logger.warn(`Maximum concurrent tokens (${MAX_CONCURRENT_TOKENS}) reached, skipping new token`);
            return;
          }

          logger.info("============== Discovered new token on pump.fun: ==============");
          logger.info("Transaction signature: ", signature);

          try {
            const parsedTransaction = await connection.getParsedTransaction(signature, {
              maxSupportedTransactionVersion: 0,
              commitment: COMMITMENT_LEVEL === "processed" ? "confirmed" : COMMITMENT_LEVEL as "confirmed" | "finalized",
            });
            if (!parsedTransaction) {
              throw new Error(`Invalid transaction, signature: ${signature}`);
            }

            const wallet = parsedTransaction.transaction.message.accountKeys[0].pubkey;
            const mint = parsedTransaction.transaction.message.accountKeys[1].pubkey;
            const tokenPoolAta = parsedTransaction.transaction.message.accountKeys[4].pubkey;

            // 将代币添加到活跃列表
            const mintStr = mint.toBase58();
            activeTokens.add(mintStr);
            logger.info(`Active tokens: ${activeTokens.size}/${MAX_CONCURRENT_TOKENS}`);

            // 延迟 2 秒，确保池初始化
            await sleep(2000);

            let buyable = true;
            if (CHECK_FILTER) {
              const filterResult = await getMintData(mint!, connection, COMMITMENT_LEVEL);
              buyable = filterResult.pass;
              logger.info(
                buyable
                  ? "🚀 ~ Token passed filter check, proceeding to buy"
                  : `🚀 ~ Token failed filter check, skipping: ${filterResult.reason}`
              );
            }

            if (buyable) {
              // 异步处理购买和监控，避免阻塞主监听
              processToken(mint, mintStr).catch((error) => {
                handleError(error, `processToken(${mintStr})`);
                activeTokens.delete(mintStr);
                logger.info(`Removed token ${mintStr}, active tokens: ${activeTokens.size}/${MAX_CONCURRENT_TOKENS}`);
              });
            } else {
              activeTokens.delete(mintStr);
              logger.info(`Removed token ${mintStr}, active tokens: ${activeTokens.size}/${MAX_CONCURRENT_TOKENS}`);
            }
          } catch (error: any) {
            handleError(error, "runListener");
          }
        }
      },
      COMMITMENT_LEVEL
    );
  } catch (error: any) {
    handleError(error, "runListener");
    if (globalLogListener !== null) {
      connection.removeOnLogsListener(globalLogListener);
      logger.info("Global log listener removed!");
      globalLogListener = null;
    }
    throw error;
  }
};

const processToken = async (mint: PublicKey, mintStr: string) => {
  try {
    const { virtualSolReserves, virtualTokenReserves, bonding, assoc_bonding_addr } = await getPoolState(mint);
    logger.info("========= Starting token purchase ==========");

    // 动态调整优先费用
    const txFee = await getDynamicPriorityFee();
    logger.info(`Dynamic transaction fee set to: ${txFee} SOL`);

    // 检查 SOL 余额
    const solBalance = await connection.getBalance(payerKeypair.publicKey);
    const requiredBalance = (QUOTE_AMOUNT / LAMPORTS_PER_SOL + (JITO_MODE ? JITO_FEE : TX_FEE)) * LAMPORTS_PER_SOL;
    if (solBalance < requiredBalance) {
      throw new Error(`Insufficient SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL < ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
    }

    // 执行买入
    logger.info(`Using QUOTE_AMOUNT: ${QUOTE_AMOUNT / LAMPORTS_PER_SOL} SOL`);
    const buyResult = await buy(payerKeypair, mint, QUOTE_AMOUNT / LAMPORTS_PER_SOL, SLIPPAGE / 100, virtualSolReserves, virtualTokenReserves, bonding, assoc_bonding_addr);
    if (!buyResult.success) {
      throw new Error(buyResult.error);
    }

    logger.info("========= Token purchase completed ==========");
    const buyerAta = await getAssociatedTokenAddress(mint, payerKeypair.publicKey);
    const balanceResult = await connection.getTokenAccountBalance(buyerAta);
    const tokenBalance = balanceResult.value.uiAmount ?? 0;
    logger.info("Buyer token balance: ", tokenBalance);

    if (buyResult.price !== undefined && buyResult.timestamp !== undefined && tokenBalance > 0) {
      await monitorAndAutoSell(mint, buyerAta, tokenBalance, buyResult.price, buyResult.timestamp, bonding, assoc_bonding_addr);
    } else {
      logger.error("Invalid purchase result or zero balance");
    }

    // 购买完成后，提示用户继续狙击
    rl.question("Press Enter to continue sniping...", () => {
      snipe_menu();
    });
  } catch (error: any) {
    throw error;
  } finally {
    activeTokens.delete(mintStr);
    logger.info(`Removed token ${mintStr}, active tokens: ${activeTokens.size}/${MAX_CONCURRENT_TOKENS}`);
  }
};

export const buy = async (
  keypair: Keypair,
  mint: PublicKey,
  solIn: number,
  slippageDecimal: number,
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
  bonding: PublicKey,
  assoc_bonding_addr: PublicKey
) => {
  const buyerWallet = keypair.publicKey;
  const tokenMint = mint;
  let buyerAta = await getAssociatedTokenAddress(tokenMint, buyerWallet);

  try {
    // 检查 SOL 余额
    const solBalance = await connection.getBalance(buyerWallet);
    const requiredBalance = solIn * LAMPORTS_PER_SOL + (JITO_MODE ? JITO_FEE : TX_FEE) * LAMPORTS_PER_SOL;
    logger.info(`Balance: ${solBalance / LAMPORTS_PER_SOL} SOL, Required: ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
    if (solBalance < requiredBalance) {
      throw new Error(`Insufficient SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL < ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
    }

    let ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((JITO_MODE ? JITO_FEE : TX_FEE) * 10 ** 9 / COMPUTE_UNIT * 10 ** 6),
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT }),
    ];

    const buyerTokenAccountInfo = await connection.getAccountInfo(buyerAta);
    if (!buyerTokenAccountInfo) {
      ixs.push(
        createAssociatedTokenAccountInstruction(
          buyerWallet,
          buyerAta,
          buyerWallet,
          tokenMint
        )
      );
    }

    const solInLamports = Math.round(solIn * LAMPORTS_PER_SOL);
    const tokenOut = Math.round((solInLamports * virtualTokenReserves.toNumber()) / virtualSolReserves.toNumber());

    // 修正 keys 数组，确保 event_authority 正确
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: bonding, isSigner: false, isWritable: true },
      { pubkey: assoc_bonding_addr, isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: buyerWallet, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: ASSOC_TOKEN_ACC_PROG, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
    ];

    // 调试 keys 数组和相关账户
    logger.info("Buy keys:", keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })));
    logger.info(`bonding: ${bonding.toBase58()}`);
    logger.info(`assoc_bonding_addr: ${assoc_bonding_addr.toBase58()}`);

    const calc_slippage_up = (sol_amount: number, slippage: number): number => {
      const lamports = sol_amount * LAMPORTS_PER_SOL;
      return Math.round(lamports * (1 + slippage));
    };

    // 注意：instruction_buf 可能需要根据 Pump.fun 最新合约更新
    const instruction_buf = Buffer.from("66063d1201daebea", "hex"); // Pump.fun buy 指令
    const token_amount_buf = Buffer.alloc(8);
    token_amount_buf.writeBigUInt64LE(BigInt(tokenOut), 0);
    const slippage_buf = Buffer.alloc(8);
    slippage_buf.writeBigUInt64LE(BigInt(calc_slippage_up(solIn, slippageDecimal)), 0);
    const data = Buffer.concat([instruction_buf, token_amount_buf, slippage_buf]);

    const swapInstruction = new TransactionInstruction({
      keys: keys,
      programId: PUMP_FUN_PROGRAM,
      data: data,
    });

    ixs.push(swapInstruction);

    const blockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: buyerWallet,
      recentBlockhash: blockhash.blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([keypair]);

    // 模拟交易，添加重试逻辑
    let simulateResult;
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      try {
        simulateResult = await connection.simulateTransaction(transaction, {
          commitment: COMMITMENT_LEVEL,
          replaceRecentBlockhash: true,
          minContextSlot: blockhash.lastValidBlockHeight,
        });
        if (!simulateResult.value.err) {
          break;
        }
        logger.error(`Simulation attempt ${retryCount + 1} failed:`, {
          error: JSON.stringify(simulateResult.value.err),
          logs: simulateResult.value.logs || [],
        });
        retryCount++;
        await sleep(1000);
      } catch (error: any) {
        logger.error(`Simulation attempt ${retryCount + 1} error:`, error.message);
        retryCount++;
        await sleep(1000);
      }
    }

    if (!simulateResult || simulateResult.value.err) {
      logger.error("Final simulation failed:", {
        error: JSON.stringify(simulateResult?.value.err || "No error details"),
        logs: simulateResult?.value.logs || [],
      });
      throw new Error("Transaction simulation failed");
    }
    logger.info("Simulation result:", simulateResult.value);

    let signature: string;
    if (JITO_MODE) {
      const bundleId = await sendJitoBundle([transaction]);
      if (!bundleId) {
        throw new Error("Jito Bundle submission failed");
      }
      signature = Buffer.from(transaction.signatures[0]).toString("base64");
      logger.info(`Submitted buy transaction via Jito Bundle, Bundle ID: ${bundleId}`);
    } else {
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: COMMITMENT_LEVEL,
        maxRetries: 5,
      });
      logger.info(`Buy transaction signature: https://solscan.io/tx/${signature}`);
    }

    let index = 0;
    let tokenBalance = 0;
    while (index < TX_NUM) {
      try {
        tokenBalance = (await connection.getTokenAccountBalance(buyerAta)).value.uiAmount!;
        if (tokenBalance > 0) {
          logger.info("🚀 ~ Token balance:", tokenBalance);
          break;
        }
      } catch (error) {
        logger.warn(`Retry ${index + 1}/${TX_NUM}: Failed to fetch token balance`);
        index++;
        await sleep(TX_DELAY * 1000);
      }
    }

    if (tokenBalance === 0) {
      throw new Error("Token snipe failed: No tokens received");
    }

    const price = solIn / tokenBalance;
    const timestamp = Date.now() / 1000;

    return { success: true, price, timestamp };
  } catch (e: any) {
    handleError(e, "buy");
    return { success: false, error: e.message };
  }
};

export const sell = async (
  keypair: Keypair,
  mint: PublicKey,
  tokenAmount: number,
  bonding: PublicKey,
  assoc_bonding_addr: PublicKey
) => {
  const buyerWallet = keypair.publicKey;
  const buyerAta = await getAssociatedTokenAddress(mint, buyerWallet);

  try {
    // 检查代币余额
    const tokenBalance = (await connection.getTokenAccountBalance(buyerAta)).value.uiAmount!;
    if (tokenBalance < tokenAmount) {
      throw new Error(`Insufficient token balance: ${tokenBalance} < ${tokenAmount}`);
    }

    // 检查 SOL 余额
    const solBalance = await connection.getBalance(buyerWallet);
    if (solBalance < (JITO_MODE ? JITO_FEE : TX_FEE) * LAMPORTS_PER_SOL) {
      throw new Error("Insufficient SOL balance for transaction fee");
    }

    // 动态调整优先费用
    const txFee = await getDynamicPriorityFee();
    logger.info(`Dynamic transaction fee set to: ${txFee} SOL`);

    let ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((JITO_MODE ? JITO_FEE : TX_FEE) * 10 ** 9 / COMPUTE_UNIT * 10 ** 6),
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT }),
    ];

    // 修正 sell 的 keys 数组
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: bonding, isSigner: false, isWritable: true },
      { pubkey: assoc_bonding_addr, isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: buyerWallet, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: ASSOC_TOKEN_ACC_PROG, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
    ];

    // 调试 keys 数组
    logger.info("Sell keys:", keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })));
    logger.info(`bonding: ${bonding.toBase58()}`);
    logger.info(`assoc_bonding_addr: ${assoc_bonding_addr.toBase58()}`);

    // 注意：instruction_buf 可能需要根据 Pump.fun 最新合约更新
    const instruction_buf = Buffer.from("b1d97428d065029b", "hex"); // Pump.fun sell 指令
    const token_amount_buf = Buffer.alloc(8);
    token_amount_buf.writeBigUInt64LE(BigInt(Math.round(tokenAmount * 10 ** 6)), 0); // 假设代币精度为 6
    const min_sol_output_buf = Buffer.alloc(8);
    min_sol_output_buf.writeBigUInt64LE(BigInt(0), 0); // 最小 SOL 输出
    const data = Buffer.concat([instruction_buf, token_amount_buf, min_sol_output_buf]);

    const sellInstruction = new TransactionInstruction({
      keys: keys,
      programId: PUMP_FUN_PROGRAM,
      data: data,
    });

    ixs.push(sellInstruction);

    const blockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: buyerWallet,
      recentBlockhash: blockhash.blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([keypair]);

    // 模拟交易，添加重试逻辑
    let simulateResult;
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      try {
        simulateResult = await connection.simulateTransaction(transaction, {
          commitment: COMMITMENT_LEVEL,
          replaceRecentBlockhash: true,
          minContextSlot: blockhash.lastValidBlockHeight,
        });
        if (!simulateResult.value.err) {
          break;
        }
        logger.error(`Simulation attempt ${retryCount + 1} failed:`, {
          error: JSON.stringify(simulateResult.value.err),
          logs: simulateResult.value.logs || [],
        });
        retryCount++;
        await sleep(1000);
      } catch (error: any) {
        logger.error(`Simulation attempt ${retryCount + 1} error:`, error.message);
        retryCount++;
        await sleep(1000);
      }
    }

    if (!simulateResult || simulateResult.value.err) {
      logger.error("Final simulation failed:", {
        error: JSON.stringify(simulateResult?.value.err || "No error details"),
        logs: simulateResult?.value.logs || [],
      });
      throw new Error("Transaction simulation failed");
    }
    logger.info("Simulation result:", simulateResult.value);

    let signature: string;
    if (JITO_MODE) {
      const bundleId = await sendJitoBundle([transaction]);
      if (!bundleId) {
        throw new Error("Jito Bundle submission failed");
      }
      signature = Buffer.from(transaction.signatures[0]).toString("base64");
      logger.info(`Submitted sell transaction via Jito Bundle, Bundle ID: ${bundleId}`);
    } else {
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: COMMITMENT_LEVEL,
        maxRetries: 5,
      });
      logger.info(`Sell transaction signature: https://solscan.io/tx/${signature}`);
    }

    return { success: true, signature };
  } catch (e: any) {
    handleError(e, "sell");
    return { success: false, error: e.message };
  }
};

const getPoolState = async (mint: PublicKey) => {
  let retryCount = 0;
  const maxRetries = 3;
  while (retryCount < maxRetries) {
    try {
      const [bonding] = PublicKey.findProgramAddressSync([BONDING_ADDR_SEED, mint.toBuffer()], TRADE_PROGRAM_ID);
      const [assoc_bonding_addr] = PublicKey.findProgramAddressSync(
        [bonding.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        ASSOC_TOKEN_ACC_PROG
      );

      const accountInfo = await connection.getAccountInfo(bonding, "confirmed");
      if (!accountInfo) throw new Error("Failed to fetch pool state: bonding account not found");

      const poolState = BONDING_CURV.decode(accountInfo.data);
      const virtualSolReserves = poolState.virtualSolReserves;
      const virtualTokenReserves = poolState.virtualTokenReserves;
      logger.info("Pool state fetched successfully");
      return { virtualSolReserves, virtualTokenReserves, bonding, assoc_bonding_addr };
    } catch (error: any) {
      retryCount++;
      logger.warn(`Retry ${retryCount}/${maxRetries} for getPoolState: ${error.message}`);
      if (retryCount >= maxRetries) {
        logger.error("Failed to fetch pool state:", error.message);
        throw new Error("Failed to fetch pool state");
      }
      await sleep(2000); // 增加重试间隔
    }
  }
  throw new Error("Failed to fetch pool state after retries");
};

const getDynamicPriorityFee = async (): Promise<number> => {
  try {
    const recentFees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: [PUMP_FUN_PROGRAM],
    });
    if (!recentFees || recentFees.length === 0) {
      logger.warn("No recent prioritization fee data, using default TX_FEE");
      return TX_FEE;
    }

    const fees = recentFees
      .map((fee: { prioritizationFee: number }) => fee.prioritizationFee)
      .sort((a: number, b: number) => a - b);
    const medianFee = fees[Math.floor(fees.length / 2)];
    const adjustedFee = Math.max(medianFee / 10 ** 9, TX_FEE);
    return Math.min(adjustedFee, 0.005);
  } catch (error: any) {
    logger.error("Failed to fetch dynamic priority fee:", error.message);
    return TX_FEE;
  }
};

const monitorAndAutoSell = async (
  mint: PublicKey,
  buyerAta: PublicKey,
  initialBalance: number,
  buyPrice: number,
  buyTimestamp: number,
  bonding: PublicKey,
  assoc_bonding_addr: PublicKey
) => {
  logger.info("Starting price monitoring...");
  let lastPrice = buyPrice;

  while (true) {
    try {
      const currentTime = Date.now() / 1000;
      if (currentTime - buyTimestamp >= HOLD_DURATION) {
        logger.info(`Holding time exceeded: ${HOLD_DURATION} seconds, triggering sell`);
        const sellResult = await sell(payerKeypair, mint, initialBalance, bonding, assoc_bonding_addr);
        if (sellResult.success) {
          logger.info("Successfully sold token due to holding duration");
          break;
        } else {
          logger.error("Sell failed:", sellResult.error);
        }
      }

      const pairAddress = mint.toBase58();
      const response = await axios.get(`${DEXSCREENER_API}${pairAddress}`);
      const pairData = response.data.pairs?.[0];
      if (!pairData) {
        logger.warn("Dexscreener found no pair data, retrying...");
        await sleep(5000);
        continue;
      }

      const currentPrice = parseFloat(pairData.priceUsd);
      const liquidity = parseFloat(pairData.liquidity?.usd || 0);
      logger.info(`Token: ${mint.toBase58()}, Price: $${currentPrice}, Liquidity: $${liquidity}`);

      const priceChange = (currentPrice - buyPrice) / buyPrice;
      if (priceChange >= TAKE_PROFIT / 100) {
        logger.info(`Triggering profit sell: ${priceChange * 100}% >= ${TAKE_PROFIT}%`);
        const sellResult = await sell(payerKeypair, mint, initialBalance, bonding, assoc_bonding_addr);
        if (sellResult.success) {
          logger.info("Successfully sold token");
          break;
        } else {
          logger.error("Sell failed:", sellResult.error);
        }
      } else if (priceChange <= -STOP_LOSS / 100) {
        logger.info(`Triggering stop-loss sell: ${priceChange * 100}% <= -${STOP_LOSS}%`);
        const sellResult = await sell(payerKeypair, mint, initialBalance, bonding, assoc_bonding_addr);
        if (sellResult.success) {
          logger.info("Successfully sold token");
          break;
        } else {
          logger.error("Sell failed:", sellResult.error);
        }
      }

      lastPrice = currentPrice;
      await sleep(5000);
    } catch (error: any) {
      handleError(error, "monitorAndAutoSell");
      await sleep(5000);
    }
  }
};

const handleError = (error: any, context: string) => {
  logger.error(`${context}: Error: ${error.message}`);
  if (error.message.includes("503") || error.message.includes("429")) {
    logger.error(`${context}: RPC connection failed, likely rate limit or server error`);
  } else if (error.message.includes("Insufficient")) {
    logger.error(`${context}: Insufficient balance: ${error.message}`);
  } else if (error.message.includes("Blockhash")) {
    logger.error(`${context}: Transaction failed due to expired blockhash`);
  } else if (error.message.includes("ConstraintSeeds")) {
    logger.error(`${context}: Seed constraint error, likely incorrect account configuration: ${error.message}`);
  } else if (error.message.includes("InstructionError")) {
    logger.error(`${context}: Instruction error, possible invalid instruction data or accounts: ${error.message}`);
  } else {
    logger.error(`${context}: Unexpected error: ${error.message}`);
  }
};