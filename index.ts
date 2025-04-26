import readline from "readline";
import { 
  title_display, 
  screen_clear, 
  main_menu_display, 
  settings_menu_display, 
  sniper_menu_display, 
  sniper_help_display, 
  constants_setting_display, 
  settings_title_display, 
  sniper_title_display, 
  constants_setting_title_display 
} from "./src/menus.js";
import { sleep } from "./src/utility.js";
import { runListener } from "./src/bot.js";
import fs from "fs";
import dotenv from "dotenv";

try {
  dotenv.config({ path: './.env' }); // 显式指定 .env 路径
  console.log("Loaded .env file successfully");
  console.log(`QUOTE_AMOUNT: ${process.env.QUOTE_AMOUNT} SOL`); // 调试输出
} catch (error: any) {
  console.error("加载 .env 文件失败:", error.message, "\n堆栈:", error.stack);
  process.exit(1);
}

const envFile = ".env";

export const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export const start = () => {
  try {
    init();
  } catch (error: any) {
    console.error("启动机器人失败:", error.message, "\n堆栈:", error.stack);
    process.exit(1);
  }
};

export const init = () => {
  screen_clear();
  title_display();
  main_menu_display();

  rl.question("\t[主菜单] - 选择: ", (answer: string) => {
    let choice = parseInt(answer);
    if (choice === 1) {
      snipe_menu();
    } else if (choice === 2) {
      settings_menu();
    } else if (choice === 3) {
      process.exit(0);
    } else {
      console.log("\t无效选择！");
      sleep(1500).then(init);
    }
  });
};

export const snipe_menu = () => {
  screen_clear();
  sniper_title_display();
  sniper_menu_display();
  rl.question("[狙击模式]-选择: ", (answer) => {
    let choice = parseInt(answer);
    if (choice === 1) {
      runSniper();
    } else if (choice === 2) {
      constantsSetting();
    } else if (choice === 3) {
      sniper_help_display();
      rl.question("按 Enter 返回: ", () => snipe_menu());
    } else if (choice === 4) {
      init();
    } else {
      console.log("\t无效选择！");
      sleep(1500).then(() => snipe_menu());
    }
  });
};

export const runSniper = async () => {
  screen_clear();
  sniper_title_display();
  try {
    await runListener();
  } catch (error: any) {
    console.error("运行狙击失败:", error.message, "\n堆栈:", error.stack);
    rl.question("按 Enter 返回: ", () => snipe_menu());
  }
};

// 更新 .env 文件
const updateEnvFile = (key: string, value: string) => {
  try {
    let envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : "";
    const lines = envContent.split('\n');
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`${key}=`)) {
        lines[i] = `${key}=${value}`;
        updated = true;
        break;
      }
    }

    if (!updated) {
      lines.push(`${key}=${value}`);
    }

    fs.writeFileSync(envFile, lines.join('\n'));
    console.log(`${key} 已更新，请重启机器人以应用更改`);
  } catch (error: any) {
    console.error(`更新 .env 失败 (${key}):`, error.message);
  }
};

export const constantsSetting = () => {
  screen_clear();
  constants_setting_title_display();
  constants_setting_display();
  rl.question("[狙击设置]-选择: ", (answer) => {
    let choice = parseInt(answer);
    if (choice === 1) {
      rl.question('\t[设置] - 交易对的报价货币 (当前仅支持 SOL): ', async (answer) => {
        updateEnvFile("QUOTE_MINT", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 2) {
      rl.question('\t[设置] - 每笔买入金额 (单位：SOL，例如 0.02): ', async (answer) => {
        updateEnvFile("QUOTE_AMOUNT", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 3) {
      rl.question('\t[设置] - 滑点 (%): ', async (answer) => {
        updateEnvFile("SLIPPAGE", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 4) {
      rl.question('\t[设置] - Jito 提示费用 (SOL): ', async (answer) => {
        updateEnvFile("JITO_FEE", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 5) {
      rl.question('\t[设置] - Jito 模式 (true/false): ', async (answer) => {
        updateEnvFile("JITO_MODE", answer.toLowerCase());
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 6) {
      rl.question('\t[设置] - 交易重试次数: ', async (answer) => {
        updateEnvFile("TX_NUM", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 7) {
      rl.question('\t[设置] - 盈利卖出百分比: ', async (answer) => {
        updateEnvFile("TAKE_PROFIT", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 8) {
      rl.question('\t[设置] - 止损卖出百分比: ', async (answer) => {
        updateEnvFile("STOP_LOSS", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 9) {
      rl.question('\t[设置] - 持有时间 (秒): ', async (answer) => {
        updateEnvFile("HOLD_DURATION", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 10) {
      rl.question('\t[设置] - 交易重试间隔 (秒): ', async (answer) => {
        updateEnvFile("TX_DELAY", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 11) {
      rl.question('\t[设置] - 交易费用 (SOL): ', async (answer) => {
        updateEnvFile("TX_FEE", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 12) {
      rl.question('\t[设置] - 计算单元: ', async (answer) => {
        updateEnvFile("COMPUTE_UNIT", answer);
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 13) {
      rl.question('\t[设置] - 日志级别 (info/debug/error): ', async (answer) => {
        updateEnvFile("LOG_LEVEL", answer.toLowerCase());
        await sleep(2000);
        constantsSetting();
      });
    } else if (choice === 14) {
      console.log("当前狙击设置:");
      console.log({
        QUOTE_MINT: process.env.QUOTE_MINT,
        QUOTE_AMOUNT: process.env.QUOTE_AMOUNT,
        SLIPPAGE: process.env.SLIPPAGE,
        JITO_FEE: process.env.JITO_FEE,
        JITO_MODE: process.env.JITO_MODE,
        TX_NUM: process.env.TX_NUM,
        TAKE_PROFIT: process.env.TAKE_PROFIT,
        STOP_LOSS: process.env.STOP_LOSS,
        HOLD_DURATION: process.env.HOLD_DURATION,
        TX_DELAY: process.env.TX_DELAY,
        TX_FEE: process.env.TX_FEE,
        COMPUTE_UNIT: process.env.COMPUTE_UNIT,
        LOG_LEVEL: process.env.LOG_LEVEL,
      });
      rl.question("按 Enter 返回: ", () => constantsSetting());
    } else if (choice === 15) {
      snipe_menu();
    } else {
      console.log("\t无效选择！");
      sleep(1500).then(() => constantsSetting());
    }
  });
};

export const settings_menu = () => {
  screen_clear();
  settings_title_display();
  settings_menu_display();
  rl.question("[设置]-选择: ", (answer: string) => {
    let choice = parseInt(answer);
    if (choice === 1) {
      rl.question('\t[设置] - RPC 端点: ', async (answer) => {
        updateEnvFile("RPC_ENDPOINT", answer);
        await sleep(2000);
        settings_menu();
      });
    } else if (choice === 2) {
      rl.question('\t[设置] - WebSocket 端点: ', async (answer) => {
        updateEnvFile("RPC_WEBSOCKET_ENDPOINT", answer);
        await sleep(2000);
        settings_menu();
      });
    } else if (choice === 3) {
      rl.question('\t[设置] - 交易确认级别 (processed/confirmed/finalized): ', async (answer) => {
        updateEnvFile("COMMITMENT_LEVEL", answer);
        await sleep(2000);
        settings_menu();
      });
    } else if (choice === 4) {
      rl.question('\t[设置] - 钱包私钥 (base58): ', async (answer) => {
        updateEnvFile("PAYERPRIVATEKEY", answer);
        await sleep(2000);
        settings_menu();
      });
    } else if (choice === 5) {
      console.log("当前设置:");
      console.log({
        RPC_ENDPOINT: process.env.RPC_ENDPOINT,
        RPC_WEBSOCKET_ENDPOINT: process.env.RPC_WEBSOCKET_ENDPOINT,
        COMMITMENT_LEVEL: process.env.COMMITMENT_LEVEL,
        PAYERPRIVATEKEY: process.env.PAYERPRIVATEKEY ? "****" : undefined,
      });
      rl.question('\n\t按 Enter 返回..', () => settings_menu());
    } else if (choice === 6) {
      init();
    } else {
      console.log("\t无效选择！");
      sleep(1500).then(() => settings_menu());
    }
  });
};

// 全局未捕获异常处理
process.on('uncaughtException', (error: Error) => {
  console.error("未捕获的异常:", error.message, "\n堆栈:", error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error("未处理的 Promise 拒绝:", reason);
  process.exit(1);
});

start();