import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import { getPdaMetadataKey } from "@raydium-io/raydium-sdk";
import { getMetadataAccountDataSerializer } from "@metaplex-foundation/mpl-token-metadata";
import * as fs from "fs";
import * as path from "path";
import {
  CHECK_NAMEBLACKLIST,
  CHECK_NAMEWHITELIST,
  CHECK_SOCIAL,
  CHECK_SOLDBALANCE,
  CHECK_WALLETBLACKLIST,
  CHECK_WALLETWHITELIST,
  MINIMUMTOKENBALANCEPERCENT,
} from "./constants";
import { sleep } from "./utility";

export const getMintData = async (
  mint: PublicKey,
  connection: Connection,
  commitment: Commitment = "confirmed"
): Promise<{ pass: boolean; reason: string }> => {
  try {
    const serializer = getMetadataAccountDataSerializer();
    const metadataPDA = getPdaMetadataKey(mint);
    const metadataAccount = await connection.getAccountInfo(metadataPDA.publicKey, commitment);
    let metaData = null;
    if (metadataAccount?.data) {
      const deserialize = serializer.deserialize(metadataAccount.data);
      const response = await fetch(deserialize[0].uri);
      metaData = await response.json();
    }

    let hasSocialState = true;
    let hasWhiteListNameState = true;
    let hasBlackListNameState = false;
    let hasWhiteListWalletState = true;
    let hasBlackListWalletState = false;
    let tokenBuyState = true;

    if (metaData) console.log("🚀 ~ hasSocials ~ data:", metaData);

    if (CHECK_SOCIAL && metaData) {
      hasSocialState = hasSocial(metaData);
      console.log("🚀 ~ hasSocials:", hasSocialState);
    }

    if (CHECK_NAMEWHITELIST && metaData) {
      hasWhiteListNameState = hasWhiteListName(metaData);
      console.log("🚀 ~ hasWhiteListNameState:", hasWhiteListNameState);
    }

    if (CHECK_NAMEBLACKLIST && metaData) {
      hasBlackListNameState = hasBlackListName(metaData);
      console.log("🚀 ~ hasBlackListNameState:", hasBlackListNameState);
    }

    if (CHECK_WALLETWHITELIST) {
      const tokenAccount = await connection.getTokenLargestAccounts(mint);
      const largestAccount = tokenAccount.value[0];
      if (!largestAccount) {
        return { pass: false, reason: "无法获取代币账户" };
      }
      hasWhiteListWalletState = hasWhiteListWallet(largestAccount.address);
      console.log("🚀 ~ hasWhiteListWalletState:", hasWhiteListWalletState);
    }

    if (CHECK_WALLETBLACKLIST) {
      const tokenAccount = await connection.getTokenLargestAccounts(mint);
      const largestAccount = tokenAccount.value[0];
      if (!largestAccount) {
        return { pass: false, reason: "无法获取代币账户" };
      }
      hasBlackListWalletState = hasBlackListWallet(largestAccount.address);
      console.log("🚀 ~ hasBlackListWalletState:", hasBlackListWalletState);
    }

    if (CHECK_SOLDBALANCE) {
      let index = 0;
      while (index <= 10) {
        try {
          const tokenAccount = await connection.getTokenLargestAccounts(mint);
          const largestAccount = tokenAccount.value[0];
          if (!largestAccount) {
            return { pass: false, reason: "无法获取代币账户" };
          }
          const tokenBal = (await connection.getTokenAccountBalance(largestAccount.address, commitment)).value.uiAmount;
          console.log("🚀 ~ tokenBal:", tokenBal);
          tokenBuyState = filterTokenBalance(tokenBal!);
          console.log("🚀 ~ tokenBuyState:", tokenBuyState);
          break;
        } catch (error) {
          index++;
          await sleep(500);
        }
      }
      if (index > 10) {
        console.log("Error getting token balance");
        tokenBuyState = false;
      }
    }

    const pass = hasSocialState && hasWhiteListNameState && !hasBlackListNameState && hasWhiteListWalletState && !hasBlackListWalletState && tokenBuyState;
    return { pass, reason: pass ? "所有检查通过" : "代币未通过过滤检查" };
  } catch (error: any) {
    console.log(error);
    return { pass: false, reason: `过滤代币失败: ${error.message}` };
  }
};

const hasSocial = (metaData: any) => {
  return metaData.twitter || metaData.telegram || metaData.website;
};

const hasWhiteListName = (metaData: any) => {
  const data = fs.readFileSync(path.join(__dirname, "../whitelist.txt"), "utf-8");
  const whiteList = data.split("\n").map((a) => a.trim()).filter((a) => a === metaData.name);
  console.log("🚀 ~ hasWhiteListName ~ metaData.name:", metaData.name);
  console.log("🚀 ~ hasWhiteListName ~ whitelistname:", whiteList);
  return whiteList.length > 0;
};

const hasBlackListName = (metaData: any) => {
  const data = fs.readFileSync(path.join(__dirname, "../blacklist.txt"), "utf-8");
  const blackList = data.split("\n").map((a) => a.trim()).filter((a) => a === metaData.name);
  console.log("🚀 ~ hasBlackListName ~ metaData.name:", metaData.name);
  console.log("🚀 ~ hasBlackListName ~ data:", blackList);
  return blackList.length > 0;
};

const hasWhiteListWallet = (wallet: PublicKey) => {
  const data = fs.readFileSync(path.join(__dirname, "../whitelistwallet.txt"), "utf-8");
  const whiteList = data.split("\n").map((a) => a.trim()).filter((a) => a === wallet.toString());
  console.log("🚀 ~ hasWhiteListWallet ~ wallet:", wallet.toString());
  console.log("🚀 ~ hasWhiteListWallet ~ data:", whiteList);
  return whiteList.length > 0;
};

const hasBlackListWallet = (wallet: PublicKey) => {
  const data = fs.readFileSync(path.join(__dirname, "../blacklistwallet.txt"), "utf-8");
  const blackList = data.split("\n").map((a) => a.trim()).filter((a) => a === wallet.toString());
  console.log("🚀 ~ hasBlackListWallet ~ wallet:", wallet.toString());
  console.log("🚀 ~ hasBlackListWallet ~ data:", blackList);
  return blackList.length > 0;
};

const filterTokenBalance = (balance: number) => {
  console.log("🚀 ~ filterTokenBalance ~ 10 ** 9 - balance:", 10 ** 9 - balance);
  return (10 ** 9 - balance) / 10 ** 9 < MINIMUMTOKENBALANCEPERCENT / 100;
};