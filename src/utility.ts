import pino from "pino";
import * as fs from "fs";
import { LOG_LEVEL, JITO_TIP_ACCOUNTS } from "./constants";
import axios from "axios";
import { VersionedTransaction, TransactionInstruction, SystemProgram, TransactionMessage } from "@solana/web3.js";
import { payerKeypair, connection, JITO_FEE } from "./constants";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const transport = pino.transport({
  target: "pino-pretty",
});

export const logger = pino(
  {
    level: LOG_LEVEL,
    redact: ["poolKeys"],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  transport
);

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const saveDataToFile = (data: any, filePath: string = "data.json") => {
  try {
    const jsonData = JSON.stringify(data);
    fs.writeFileSync(filePath, jsonData);
    console.log("数据已成功保存到 JSON 文件");
  } catch (error) {
    console.error("保存数据到 JSON 文件时出错:", error);
  }
};

export const sendJitoBundle = async (transactions: VersionedTransaction[]): Promise<string | null> => {
  try {
    // 确保 Bundle 不超过 5 个交易
    if (transactions.length > 5) {
      throw new Error("Jito Bundle 最多包含 5 个交易");
    }

    // 随机选择 Jito 提示账户
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

    // 添加提示交易
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: payerKeypair.publicKey,
      toPubkey: tipAccount,
      lamports: Math.round(JITO_FEE * LAMPORTS_PER_SOL),
    });

    const blockhash = await connection.getLatestBlockhash();
    const tipMessage = new TransactionMessage({
      payerKey: payerKeypair.publicKey,
      recentBlockhash: blockhash.blockhash,
      instructions: [tipInstruction],
    }).compileToV0Message();
    const tipTransaction = new VersionedTransaction(tipMessage);
    tipTransaction.sign([payerKeypair]);

    // 合并交易和提示交易
    const allTransactions = [...transactions, tipTransaction];
    const serializedTxs = allTransactions.map((tx) => Buffer.from(tx.serialize()).toString("base64"));

    // 随机选择 Jito 端点
    const jitoEndpoints = [
      "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
      "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
      "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
    ];
    const endpoint = jitoEndpoints[Math.floor(Math.random() * jitoEndpoints.length)];

    // 构造 Bundle 请求
    const bundle = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [serializedTxs],
    };

    // 发送请求
    const response = await axios.post(endpoint, bundle, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.data.error) {
      throw new Error(`Jito Bundle 提交失败: ${response.data.error.message} (HTTP ${response.status})`);
    }

    const bundleId = response.data.result;
    logger.info(`Jito Bundle 提交成功，Bundle ID: ${bundleId}, Endpoint: ${endpoint}, Tip Account: ${tipAccount.toBase58()}`);
    return bundleId;
  } catch (error: any) {
    logger.error({
      context: "sendJitoBundle",
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    return null;
  }
};