/**
 * Record page (React 18 + TSX) — 3 领域 Tab 容器
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/pages/record/index.vue
 * 最后同步：2026-09-19（md/spec-20260919-v1 第四轮重构）
 *
 * 演进：
 *   M2   ：从单体拆成 Tab 布局。
 *   D-03 ：删「资产」Tab（与「账户」同为 AccountManager 薄壳，纯重复）；
 *          「支出」「收入」合并为单一「收支」。5 Tab → 3 Tab。
 *   260919-3：追加「经期」Tab（记录模块第 4 个 Tab）。
 *   **v1（本轮）：4 Tab → 3 领域 Tab —— 习惯 | 财务 | 健康**。
 *          · 收支 / 预算 / 账户 三个财务子视图收进「财务」Tab，用页内
 *            分段控件切换（见 FinancialTab）。
 *          · 「经期」并入新的「健康」Tab —— 健康是「测出来的数」的家，
 *            经期事实只是其中一块（spec 01 §2）。
 *          · **HabitSection 从「Tabs 之上常驻」移入「习惯」Tab**
 *            （spec 09 Q5 决议：与移动端 IA 对齐，同一套领域划分）。
 *            代价：习惯从「永远可见」变成「要点一下」。
 *          · **MoodSection 从「习惯」Tab 挪进「健康」Tab**（老大 260919 复核 spec 指出）：
 *            spec 01 §4 的记录模块只有 习惯 / 财务 / 健康，心情与精力是**健康**的指标
 *            （02 §2 注册表第 3 / 4 项）。⚠️ 是搬家不是删除 —— MoodSection 是唯一能看到
 *            按小时心情历史的入口（首页只有 chips），删了就把按小时记录能力埋掉了。
 *
 * ⚠️ 后端在这轮**零改动**：`/accounts` `/transactions` `/budgets` 三组接口
 *    保持原样，财务三合一是纯前端信息架构调整（07 §3 明确要求不要动后端路由）。
 */
import { useState, useEffect } from 'react'
import { Card, Tabs, TabPane, Button } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { useHabitStore } from '@/stores/habit'
import { useFinanceStore } from '@/stores/finance'
import TransactionEditDrawer from '@/components/TransactionEditDrawer'
import type { CreateTransactionReq } from '@/api/types'
import HabitSection from './HabitSection'
import FinancialTab, { type FinanceSub } from './FinancialTab'
import HealthTab from './HealthTab'

export default function RecordPage() {
  const habitStore = useHabitStore()
  const financeStore = useFinanceStore()
  const [activeTab, setActiveTab] = useState('habit')
  const [financeSub, setFinanceSub] = useState<FinanceSub>('transactions')
  const [txDrawerVisible, setTxDrawerVisible] = useState(false)
  const [txSaving, setTxSaving] = useState(false)

  useEffect(() => {
    habitStore.fetchList()
    financeStore.fetchAccounts()
    financeStore.fetchTransactions()
    financeStore.fetchBudgets()
  }, [])

  async function onTxSubmit(data: CreateTransactionReq) {
    setTxSaving(true)
    try {
      const created = await financeStore.createTransaction(data)
      if (created) setTxDrawerVisible(false)
    } finally {
      setTxSaving(false)
    }
  }

  /** 页头「记一笔」：先切到财务 Tab，再落到收支子视图 */
  function onQuickCreate() {
    setFinanceSub('transactions')
    setActiveTab('finance')
  }

  return (
    <div className="record-page">
      {/* D-03 第七轮：去页内大标题（与顶部导航重复），改用户管理式一行小字 */}
      <div className="page-tipbar">
        <span className="page-tip">记录 · 习惯、财务与健康，三个领域各归其位</span>
        <div className="header-right">
          <Button theme="light" type="secondary" icon={<Icon name="RefreshCw" size={16} />} onClick={() => setTxDrawerVisible(true)}>转账</Button>
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={onQuickCreate}>记一笔</Button>
        </div>
      </div>

      <Card bordered={false} className="card">
        <Tabs type="line" activeKey={activeTab} onChange={(key: string) => setActiveTab(key)}>
          <TabPane itemKey="habit" tab="习惯">
            <HabitSection />
          </TabPane>
          <TabPane itemKey="finance" tab="财务">
            <FinancialTab sub={financeSub} onSubChange={setFinanceSub} />
          </TabPane>
          <TabPane itemKey="health" tab="健康">
            <HealthTab />
          </TabPane>
        </Tabs>
      </Card>

      {/* Transfer drawer — shared by header 转账 button (P0-02) */}
      <TransactionEditDrawer
        visible={txDrawerVisible}
        accounts={financeStore.accounts}
        defaultType="transfer"
        saving={txSaving}
        onClose={() => setTxDrawerVisible(false)}
        onSubmit={onTxSubmit}
      />
    </div>
  )
}
