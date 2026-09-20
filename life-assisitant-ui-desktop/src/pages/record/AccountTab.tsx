/**
 * AccountTab — 账户管理 Tab（总资产卡 + 账户网格 + 转账）。
 *
 * D-03 第十六轮：原「资产」Tab（AssetTab）删除 —— 两者是同一
 * <AccountManager /> 的薄壳、内容逐像素相同，纯重复入口。
 * 账户相关全部能力（看总资产、管账户、转账）都在本 Tab。
 */
import { AccountManager } from './components/AccountManager'

export function AccountTab() {
  return (
    <div className="account-tab">
      <AccountManager />
    </div>
  )
}

export default AccountTab
