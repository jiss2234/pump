export const title_display = () => {
  console.log("\n\t=== Solana 狙击机器人 ===");
};

export const settings_title_display = () => {
  console.log("\n\t=== 设置菜单 ===");
};

export const sniper_title_display = () => {
  console.log("\n\t=== 狙击模式 ===");
};

export const constants_setting_title_display = () => {
  console.log("\n\t=== 狙击设置 ===");
};

export const screen_clear = () => {
  console.clear();
};

export const main_menu_display = () => {
  console.log('\t[1] - 狙击模式');
  console.log('\t[2] - 设置');
  console.log('\t[3] - 退出');
};

export const constants_setting_display = () => {
  console.log('\t[1] - 交易对的报价货币 (当前仅支持 SOL)');
  console.log('\t[2] - 每笔买入金额 (单位：SOL)');
  console.log('\t[3] - 滑点');
  console.log('\t[4] - Jito 提示费用');
  console.log('\t[5] - Jito 模式');
  console.log('\t[6] - 交易重试次数');
  console.log('\t[7] - 盈利卖出百分比');
  console.log('\t[8] - 止损卖出百分比');
  console.log('\t[9] - 持有时间');
  console.log('\t[10] - 交易重试间隔');
  console.log('\t[11] - 交易费用');
  console.log('\t[12] - 计算单元');
  console.log('\t[13] - 日志级别');
  console.log('\t[14] - 显示当前设置');
  console.log('\t[15] - 返回');
};

export const settings_menu_display = () => {
  console.log('\t[1] - 更改 RPC 端点');
  console.log('\t[2] - 更改 WebSocket 端点');
  console.log('\t[3] - 更改交易确认级别');
  console.log('\t[4] - 更改钱包');
  console.log('\t[5] - 显示当前设置');
  console.log('\t[6] - 返回');
};

export const sniper_menu_display = () => {
  console.log('\t[1] - 运行狙击');
  console.log('\t[2] - 狙击设置');
  console.log('\t[3] - 帮助');
  console.log('\t[4] - 返回');
};

export const sniper_help_display = () => {
  console.log('\t免责声明: \t- 确保所有输入有效，机器人将自动开始狙击！');
  console.log('\t            \t- 请仔细检查监控中的数量和池信息');
  console.log('\t            \t  以避免输入错误和价格冲击');
};