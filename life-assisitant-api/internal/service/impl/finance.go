// Package impl 记账服务实现
// 业务规则：
//  1. 只能操作自己的账户/交易/预算（user_id 从 ctx 取）
//  2. amount 始终为正（用 float64；DB 列 DECIMAL(18,2) 自动精度控制）
//  3. CreateTransaction 事务内：insert tx + 更新账户余额（expense 减、income 加）
//  4. Transfer 事务内：insert transfer tx + 扣 from 余额 + 加 to 余额
//  5. UpdateTransaction：expense/income 改 amount 时，同步账户余额
//  6. DeleteTransaction：expense/income 删时，反向回滚账户余额
//  7. Budget.used 由后端实时从 transactions 计算（不存表）
//  8. 不做：分类管理、附件
package impl

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// FinanceService 记账服务实现
type FinanceService struct{}

func NewFinanceService() service.IFinanceService { return &FinanceService{} }

// Register 注册
func init() { service.SetFinance(NewFinanceService()) }

// ====== 公共辅助 ======

func accountToResp(a *model.Account) *dto.AccountResp {
	return &dto.AccountResp{
		ID:          a.ID,
		Name:        a.Name,
		Type:        a.Type,
		Institution: a.Institution,
		Icon:        a.Icon,
		Color:       a.Color,
		Balance:     a.Balance,
		CreatedAt:   a.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   a.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func transactionToResp(ctx context.Context, t *model.Transaction) *dto.TransactionResp {
	resp := &dto.TransactionResp{
		ID:         t.ID,
		Type:       t.Type,
		Amount:     t.Amount,
		AccountID:  t.AccountID,
		HappenedAt: t.HappenedAt.UTC().Format(time.RFC3339),
		CreatedAt:  t.CreatedAt.UTC().Format(time.RFC3339),
	}
	if t.CategoryID != nil {
		resp.CategoryID = *t.CategoryID
	}
	if t.CategoryEmoji != nil {
		resp.CategoryEmoji = *t.CategoryEmoji
	}
	if t.CategoryName != nil {
		resp.CategoryName = *t.CategoryName
	}
	if t.AccountName != nil {
		resp.AccountName = *t.AccountName
	}
	if t.ToAccountID != nil {
		resp.ToAccountID = *t.ToAccountID
	}
	if t.ToAccountName != nil {
		resp.ToAccountName = *t.ToAccountName
	}
	if t.Note != nil {
		resp.Note = *t.Note
	}
	if t.UpdatedAt.Unix() > 0 {
		resp.UpdatedAt = t.UpdatedAt.UTC().Format(time.RFC3339)
	}
	if t.ReversedBy != nil {
		resp.ReversedBy = *t.ReversedBy
	}
	// 计入口径 / 来源 / 关联（260921 v2 + v4）
	resp.ExcludeBudget = t.ExcludeBudget
	resp.ExcludeStats = t.ExcludeStats
	resp.Source = t.Source
	resp.Contact = t.Contact
	resp.SettleOf = t.SettleOf
	return resp
}

// parseHappenedAt 解析发生时间
func parseHappenedAt(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Now(), nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if t, err := time.ParseInLocation("2006-01-02 15:04:05", s, time.Local); err == nil {
		return t, nil
	}
	if t, err := time.ParseInLocation("2006-01-02", s, time.Local); err == nil {
		return t, nil
	}
	return time.Time{}, gerror.NewCode(ecode.ValidationFailed)
}

// findActiveCategory 在给定 DB 句柄上取「未删除」的分类（传 *gorm.DB 事务句柄即可与写交易同事务）。
//
// ⚠️ 必须同时按 user_id 限定：内置分类 id（如 fc_b_food）**跨用户重复**
// （分类是用户级、内置种子每人一份），只按 id 查会命中别人的分类。
func findActiveCategory(db *gorm.DB, userID, id string) (*model.FinanceCategory, error) {
	var c model.FinanceCategory
	if err := db.Where("user_id = ? AND id = ? AND is_deleted = 0", userID, id).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// categorySnapshot 取分类快照（full_name / emoji），供交易与预算写入时留痕
func categorySnapshot(c *model.FinanceCategory) (fullName string, emoji *string) {
	fullName = c.Name
	if c.FullName != nil && *c.FullName != "" {
		fullName = *c.FullName
	}
	return fullName, c.Emoji
}

// ====== 账户 ======

func (s *FinanceService) ListAccounts(ctx context.Context) (*dto.ListAccountsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	items, err := dao.Account.List(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询账户列表失败")
	}
	out := make([]dto.AccountResp, 0, len(items))
	var total float64
	// spec-20260922-v1 Phase 4：同一循环内按 L1 大类归并（不加查询；与 GetBalanceSummary 同口径）
	var assets, investments, debts float64
	for i := range items {
		out = append(out, *accountToResp(&items[i]))
		total += items[i].Balance
		switch utility.AccountCategoryOf(items[i].Type) {
		case utility.AccountCategoryCredit:
			debts += items[i].Balance
		case utility.AccountCategoryInvestment:
			investments += items[i].Balance
		default:
			assets += items[i].Balance
		}
	}
	return &dto.ListAccountsResp{
		Items: out, TotalBalance: total, Total: len(out),
		Assets: assets, Investments: investments, Debts: debts, NetWorth: total,
	}, nil
}

func (s *FinanceService) GetTotalBalance(ctx context.Context) (*dto.TotalBalanceResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	// P2：按 type 分组求和 → 按 L1 大类归并（01 §5.2）；旧 GetTotalBalance DAO 保留供 stats 用
	sum, err := dao.Account.GetBalanceSummary(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询总余额失败")
	}
	return &dto.TotalBalanceResp{
		TotalBalance: sum.NetWorth, // 旧字段语义冻结 = SUM(全部 balance)（D25）
		Total:        sum.NetWorth,
		Assets:       sum.Assets,
		Investments:  sum.Investments,
		Debts:        sum.Debts, // 负数原值
		NetWorth:     sum.NetWorth,
		AccountCount: sum.AccountCount,
	}, nil
}

func (s *FinanceService) CreateAccount(ctx context.Context, req *dto.CreateAccountReq) (*dto.AccountResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, gerror.NewCode(ecode.AccountNameEmpty)
	}
	// type 白名单（D21：此前无校验直接落库，是既有缺陷）
	if !utility.IsValidAccountType(req.Type) {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	// institution 只校验长度 ≤20（不校验白名单，D20：银行清单会随版本增删，硬校验会让存量账户写不回去）
	institution := strings.TrimSpace(req.Institution)
	if utf8.RuneCountInString(institution) > 20 {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	icon := req.Icon
	if icon == "" {
		icon = "💰"
	}
	color := req.Color
	if color == "" {
		color = "#E0F2FF"
	}

	a := &model.Account{
		ID:          utility.NewID("a"),
		UserID:      uid,
		Name:        name,
		Type:        req.Type,
		Institution: institution,
		Icon:        icon,
		Color:       color,
		Balance:     req.Balance,
	}
	if err := dao.Account.Create(ctx, a); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建账户失败")
	}
	return accountToResp(a), nil
}

func (s *FinanceService) UpdateAccount(ctx context.Context, id string, req *dto.UpdateAccountReq) (*dto.AccountResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Account.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.AccountNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询账户失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.AccountAccessDenied)
	}

	updates := map[string]any{}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" {
			return nil, gerror.NewCode(ecode.AccountNameEmpty)
		}
		updates["name"] = n
	}
	if req.Icon != nil {
		updates["icon"] = *req.Icon
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	// institution 可改（空串 = 清空 = 未指定）；只校验长度 ≤20，不校验白名单（D20）
	if req.Institution != nil {
		inst := strings.TrimSpace(*req.Institution)
		if utf8.RuneCountInString(inst) > 20 {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		updates["institution"] = inst
	}
	// type 可改（Q5 老大拍板放开）：可选字段缺省=不改；白名单校验同 Create。
	// ⚠️ 跨 L1 的余额符号自动取负是前端交互职责（01 §8.3.2），后端只存不加工。
	if req.Type != nil {
		if !utility.IsValidAccountType(*req.Type) {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		updates["type"] = *req.Type
	}
	// 余额调整：计算差额，决定是否生成流水
	var balanceFlowTx *model.Transaction
	if req.Balance != nil {
		newBal := *req.Balance
		diff := newBal - exist.Balance
		updates["balance"] = newBal
		// 仅在显式传 true 且余额真的变了（|差额| >= 0.005）时，生成余额调整流水
		if req.RecordFlow != nil && *req.RecordFlow && math.Abs(diff) >= 0.005 {
			txType := model.TransactionTypeExpense
			if diff > 0 {
				txType = model.TransactionTypeIncome
			}
			accName := exist.Name
			note := "余额调整"
			catName := "余额调整"
			balanceFlowTx = &model.Transaction{
				ID:            utility.NewID("tx"),
				UserID:        uid,
				Type:          txType,
				Amount:        math.Abs(diff),
				AccountID:     id,
				AccountName:   &accName,
				HappenedAt:    time.Now(),
				Note:          &note,
				CategoryName:  &catName,
				CategoryID:    nil,
				ToAccountID:   nil,
				Source:        model.TxSourceBalanceAdj,
				ExcludeBudget: true,
				ExcludeStats:  false,
			}
		}
	}
	if len(updates) == 0 {
		return accountToResp(exist), nil
	}
	// 如果改了账户名，同步更新所有关联交易记录的冗余账户名
	if req.Name != nil && strings.TrimSpace(*req.Name) != exist.Name {
		newName := strings.TrimSpace(*req.Name)
		if err := dao.DB.WithContext(ctx).Model(&model.Transaction{}).
			Where("user_id = ? AND account_id = ?", uid, id).
			Update("account_name", newName).Error; err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "同步交易账户名失败")
		}
		if err := dao.DB.WithContext(ctx).Model(&model.Transaction{}).
			Where("user_id = ? AND to_account_id = ?", uid, id).
			Update("to_account_name", newName).Error; err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "同步交易对方账户名失败")
		}
	}
	// 余额覆盖更新 + 余额调整流水插入必须在同一事务（约束 2）；
	// 流水**直接 insert**，绝不走 CreateTransaction 的余额加减路径（约束 1：否则双重计算）
	if err := dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Account{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		if balanceFlowTx != nil {
			if err := tx.Create(balanceFlowTx).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新账户失败")
	}
	fresh, err := dao.Account.GetByID(ctx, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询账户失败")
	}
	return accountToResp(fresh), nil
}

func (s *FinanceService) DeleteAccount(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Account.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.AccountNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询账户失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return gerror.NewCode(ecode.AccountAccessDenied)
	}
	if err := dao.Account.Delete(ctx, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除账户失败")
	}
	return nil
}

// ====== 交易 ======

func (s *FinanceService) ListTransactions(ctx context.Context, req *dto.ListTransactionsReq) (*dto.ListTransactionsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}

	opts := dao.TransactionListOptions{
		UserID:    uid,
		Type:      req.Type,
		AccountID: req.AccountID,
		Keyword:   strings.TrimSpace(req.Keyword),
		Contact:   strings.TrimSpace(req.Contact),
		Page:      page,
		PageSize:  pageSize,
	}
	// type 白名单：'' / expense / income / transfer；其余 → 400001
	if req.Type != "" &&
		req.Type != model.TransactionTypeExpense &&
		req.Type != model.TransactionTypeIncome &&
		req.Type != model.TransactionTypeTransfer {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	if s := strings.TrimSpace(req.StartDate); s != "" {
		t, err := time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		opts.StartDate = &t
	}
	if e := strings.TrimSpace(req.EndDate); e != "" {
		t, err := time.ParseInLocation("2006-01-02", e, time.Local)
		if err != nil {
			return nil, gerror.WrapCode(ecode.ValidationFailed, err, "结束日期格式错误")
		}
		tNext := t.AddDate(0, 0, 1)
		opts.EndDate = &tNext
	}

	items, total, err := dao.Transaction.List(ctx, opts)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询交易列表失败")
	}
	out := make([]dto.TransactionResp, 0, len(items))
	for i := range items {
		out = append(out, *transactionToResp(ctx, &items[i]))
	}
	return &dto.ListTransactionsResp{Items: out, Total: total}, nil
}

func (s *FinanceService) GetTransaction(ctx context.Context, id string) (*dto.TransactionResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	t, err := dao.Transaction.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.TransactionNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询交易失败")
	}
	if t.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.TransactionAccessDenied)
	}
	return transactionToResp(ctx, t), nil
}

func (s *FinanceService) CreateTransaction(ctx context.Context, req *dto.CreateTransactionReq) (*dto.TransactionResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if req.Type != model.TransactionTypeExpense && req.Type != model.TransactionTypeIncome {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	if req.Amount <= 0 {
		return nil, gerror.NewCode(ecode.TransactionAmountInvalid)
	}
	if req.AccountID == "" {
		return nil, gerror.NewCode(ecode.AccountNotFound)
	}

	happened, err := parseHappenedAt(req.HappenedAt)
	if err != nil {
		return nil, err
	}

	acc, err := dao.Account.GetByID(ctx, req.AccountID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.AccountNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询账户失败")
	}
	if acc.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.AccountAccessDenied)
	}

	// 来源白名单：系统内部来源 balance_adjust 不允许前端伪造（允许空/reimburse/lend/borrow/refund）
	switch req.Source {
	case "", model.TxSourceReimburse, model.TxSourceLend, model.TxSourceBorrow, model.TxSourceRefund:
		// 允许
	default:
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// 关联原交易校验（核销 / 退还）：存在 + 未删(软删自动过滤) + 同主 + 原笔非核销笔 + source 一致
	if req.SettleOf != "" {
		orig, oerr := dao.Transaction.GetByID(ctx, req.SettleOf)
		if oerr != nil {
			if errors.Is(oerr, gorm.ErrRecordNotFound) {
				return nil, gerror.NewCode(ecode.ValidationFailed)
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, oerr, "查询关联原交易失败")
		}
		if orig.UserID != uid { // ⚠️ 跨用户关联防护
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		if orig.SettleOf != "" { // 不能核销一笔核销笔
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		if orig.Source != req.Source { // source 必须与原笔一致
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		// 强制继承 contact（漏了债权债务聚合会静默漏）
		if strings.TrimSpace(req.Contact) == "" {
			req.Contact = orig.Contact
		}
	}

	t := &model.Transaction{
		ID:          utility.NewID("tx"),
		UserID:      uid,
		Type:        req.Type,
		Amount:      req.Amount,
		AccountID:   req.AccountID,
		AccountName: &acc.Name,
		HappenedAt:  happened,
		// 计入口径 / 来源 / 关联（260921 v2 + v4）
		ExcludeBudget: req.ExcludeBudget,
		ExcludeStats:  req.ExcludeStats,
		Source:        req.Source,
		Contact:       req.Contact,
		SettleOf:      req.SettleOf,
	}
	if emoji := strings.TrimSpace(req.CategoryEmoji); emoji != "" {
		t.CategoryEmoji = &emoji
	}
	if name := strings.TrimSpace(req.CategoryName); name != "" {
		t.CategoryName = &name
	}
	if note := strings.TrimSpace(req.Note); note != "" {
		t.Note = &note
	}
	// 传了 category_id 时，快照以分类表为准（下方 tx 内查询后覆写），
	// 先清掉老客户端可能同时传来的文本值，避免落脏。
	hasCategoryID := strings.TrimSpace(req.CategoryID) != ""
	if hasCategoryID {
		t.CategoryEmoji = nil
		t.CategoryName = nil
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// ⚠️ 查分类取 full_name + 写交易必须**同事务**（06 §5：避免读到刚被删的分类）
		if hasCategoryID {
			cat, err := findActiveCategory(tx, uid, strings.TrimSpace(req.CategoryID))
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return gerror.NewCode(ecode.FinanceCategoryInvalid)
				}
				return err
			}
			// 分类不可跨 tree 使用：支出交易不能选收入分类（06 §2.1）
			if cat.Scope != req.Type {
				return gerror.NewCode(ecode.FinanceCategoryInvalid)
			}
			full, emoji := categorySnapshot(cat)
			catID := cat.ID
			t.CategoryID = &catID
			t.CategoryName = &full
			t.CategoryEmoji = emoji
		}
		if err := tx.Create(t).Error; err != nil {
			return err
		}
		// expense: delta = -amount; income: delta = +amount
		var delta float64
		if req.Type == model.TransactionTypeExpense {
			delta = -req.Amount
		} else {
			delta = req.Amount
		}
		// 余额不足校验（D24）：仅 asset / investment 拦截；credit 类余额天然为负（欠款），放行
		var curBal float64
		if err := tx.Model(&model.Account{}).Where("id = ?", req.AccountID).
			Select("balance").Scan(&curBal).Error; err != nil {
			return err
		}
		if utility.AccountCategoryOf(acc.Type) != utility.AccountCategoryCredit && curBal+delta < 0 {
			return gerror.NewCode(ecode.AccountInsufficient)
		}
		res := tx.Model(&model.Account{}).Where("id = ?", req.AccountID).
			Update("balance", gorm.Expr("balance + ?", delta))
		if res.Error != nil {
			return res.Error
		}
		return nil
	})
	if err != nil {
		if gerror.HasCode(err, &ecode.FinanceCategoryInvalid) {
			return nil, err
		}
		if gerror.HasCode(err, &ecode.Success) {
			return nil, err
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建交易失败")
	}
	return transactionToResp(ctx, t), nil
}

func (s *FinanceService) UpdateTransaction(ctx context.Context, id string, req *dto.UpdateTransactionReq) (*dto.TransactionResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Transaction.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.TransactionNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询交易失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.TransactionAccessDenied)
	}
	if exist.Type == model.TransactionTypeTransfer {
		return nil, gerror.NewCode(ecode.TransactionTypeInvalid)
	}

	updates := map[string]any{}
	amountChanged := false
	if req.Amount != nil {
		if *req.Amount <= 0 {
			return nil, gerror.NewCode(ecode.TransactionAmountInvalid)
		}
		if *req.Amount != exist.Amount {
			amountChanged = true
		}
		updates["amount"] = *req.Amount
	}
	if req.CategoryEmoji != nil {
		if *req.CategoryEmoji == "" {
			updates["category_emoji"] = nil
		} else {
			updates["category_emoji"] = *req.CategoryEmoji
		}
	}
	if req.CategoryName != nil {
		if *req.CategoryName == "" {
			updates["category_name"] = nil
		} else {
			updates["category_name"] = *req.CategoryName
		}
	}

	// 口径开关 / 对方（指针：缺省=不改；source / settle_of 禁止修改）
	if req.ExcludeBudget != nil {
		updates["exclude_budget"] = *req.ExcludeBudget
	}
	if req.ExcludeStats != nil {
		updates["exclude_stats"] = *req.ExcludeStats
	}
	if req.Contact != nil {
		updates["contact"] = *req.Contact
	}

	// 分类 id：传了就以其 full_name / emoji 为准（与写交易同事务解析，见 applyCategory）
	catProvided := req.CategoryID != nil
	catID := ""
	if catProvided {
		catID = strings.TrimSpace(*req.CategoryID)
		if catID != "" {
			// id 优先，忽略同时传来的文本快照
			delete(updates, "category_name")
			delete(updates, "category_emoji")
		}
	}
	applyCategory := func(db *gorm.DB) error {
		if !catProvided {
			return nil
		}
		if catID == "" {
			// 空串 = 清空分类（保留 category_name 快照，仅解除 id 关联）
			updates["category_id"] = nil
			return nil
		}
		cat, err := findActiveCategory(db, uid, catID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return gerror.NewCode(ecode.FinanceCategoryInvalid)
			}
			return err
		}
		if cat.Scope != exist.Type {
			return gerror.NewCode(ecode.FinanceCategoryInvalid)
		}
		full, emoji := categorySnapshot(cat)
		updates["category_id"] = cat.ID
		updates["category_name"] = full
		updates["category_emoji"] = emoji
		return nil
	}

	accountChanged := req.AccountID != nil && *req.AccountID != "" && *req.AccountID != exist.AccountID

	if amountChanged || accountChanged {
		// 事务：先回滚原账户原 amount，再应用新账户新 amount
		var newAmount float64
		if req.Amount != nil {
			newAmount = *req.Amount
		} else {
			newAmount = exist.Amount
		}
		newAccountID := exist.AccountID
		if accountChanged {
			newAccountID = *req.AccountID
			newAcc, err := dao.Account.GetByID(ctx, newAccountID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, gerror.NewCode(ecode.AccountNotFound)
				}
				return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询新账户失败")
			}
			if newAcc.UserID != uid {
				return nil, gerror.NewCode(ecode.AccountAccessDenied)
			}
			updates["account_id"] = newAccountID
		}

		err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// 0. 分类解析（与写交易同事务）
			if err := applyCategory(tx); err != nil {
				return err
			}
			// 1. 反向：原账户恢复
			var origDelta float64
			if exist.Type == model.TransactionTypeExpense {
				origDelta = exist.Amount
			} else {
				origDelta = -exist.Amount
			}
			if err := tx.Model(&model.Account{}).Where("id = ?", exist.AccountID).
				Update("balance", gorm.Expr("balance + ?", origDelta)).Error; err != nil {
				return err
			}
			// 2. 正向：新账户应用
			var newDelta float64
			if exist.Type == model.TransactionTypeExpense {
				newDelta = -newAmount
			} else {
				newDelta = newAmount
			}
			// 余额检查（D24）：仅 asset / investment 拦截；credit 类放行（余额天然为负）
			var cur struct {
				Balance float64
				Type    string
			}
			if err := tx.Model(&model.Account{}).Where("id = ?", newAccountID).
				Select("balance, type").Scan(&cur).Error; err != nil {
				return err
			}
			if utility.AccountCategoryOf(cur.Type) != utility.AccountCategoryCredit && cur.Balance+newDelta < 0 {
				return gerror.NewCode(ecode.AccountInsufficient)
			}
			if err := tx.Model(&model.Account{}).Where("id = ?", newAccountID).
				Update("balance", gorm.Expr("balance + ?", newDelta)).Error; err != nil {
				return err
			}
			// 3. 更新 tx
			if err := tx.Model(&model.Transaction{}).Where("id = ?", id).Updates(updates).Error; err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			if gerror.HasCode(err, &ecode.FinanceCategoryInvalid) {
				return nil, err
			}
			if gerror.HasCode(err, &ecode.Success) {
				return nil, err
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新交易失败")
		}
	} else {
		if len(updates) == 0 && !catProvided {
			return transactionToResp(ctx, exist), nil
		}
		if err := applyCategory(dao.DB.WithContext(ctx)); err != nil {
			if gerror.HasCode(err, &ecode.FinanceCategoryInvalid) {
				return nil, err
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新交易失败")
		}
		if err := dao.Transaction.Update(ctx, id, updates); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新交易失败")
		}
	}

	fresh, err := dao.Transaction.GetByID(ctx, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询交易失败")
	}
	return transactionToResp(ctx, fresh), nil
}

func (s *FinanceService) DeleteTransaction(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Transaction.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.TransactionNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询交易失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return gerror.NewCode(ecode.TransactionAccessDenied)
	}
	if exist.Type == model.TransactionTypeTransfer {
		return gerror.NewCode(ecode.TransactionTypeInvalid)
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 反向：expense → 加，income → 减
		var delta float64
		if exist.Type == model.TransactionTypeExpense {
			delta = exist.Amount
		} else {
			delta = -exist.Amount
		}
		if err := tx.Model(&model.Account{}).Where("id = ?", exist.AccountID).
			Update("balance", gorm.Expr("balance + ?", delta)).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).Delete(&model.Transaction{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if gerror.HasCode(err, &ecode.Success) {
			return err
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "删除交易失败")
	}
	return nil
}

// ====== 预算 ======

// budgetCurrentRange 预算「当前期」区间（口径修复 S1，06 §1.2）。
//
// ⚠️ 对 period-based 预算（weekly/monthly/yearly），读取时按**当前时间**推算区间、
// 忽略创建时冻结的 start_date/end_date —— 否则 9 月建的月预算进 10 月后 used 永远停在 9 月。
// 周口径**只此一处推算**（复用 parseBudgetDates，周一为周首 weekday==0→7），
// 与 GET /finance/summary 共用同一函数，禁止各写一份。
// 非标准 period / 异常值 → 兜底返回存储的冻结区间。零数据迁移（只在读时算）。
func budgetCurrentRange(b *model.Budget) (time.Time, time.Time) {
	switch b.Period {
	case model.BudgetPeriodWeekly, model.BudgetPeriodMonthly, model.BudgetPeriodYearly:
		if s, e, err := parseBudgetDates("", "", b.Period); err == nil {
			return s, e
		}
	}
	return b.StartDate, b.EndDate
}

// budgetToResp 将 Budget 实体转为 DTO，并实时计算 used 字段
//
// ⚠️ used 用 budgetCurrentRange（按当前期滚动，S1 修复）；
// start_date / end_date 响应字段**保留返回存储值**（语义降级为「创建时的参考值」，06 §1.2）。
func budgetToResp(ctx context.Context, b *model.Budget) *dto.BudgetResp {
	var used float64
	catID, catName := "", ""
	if b.CategoryID != nil {
		catID = *b.CategoryID
	}
	if b.CategoryName != nil {
		catName = *b.CategoryName
	}
	curStart, curEnd := budgetCurrentRange(b)
	if b.Scope == model.BudgetScopeCategory && (catID != "" || catName != "") {
		// ⚠️ 按 id 匹配且含子分类（02 §6.2 / §6.3）；catID 为空时退化为 name 匹配（历史预算）
		used, _ = dao.Budget.SumExpenseByCategory(ctx, b.UserID, catID, catName, curStart, curEnd)
	} else {
		used, _ = dao.Budget.SumExpense(ctx, b.UserID, curStart, curEnd)
	}
	resp := &dto.BudgetResp{
		ID:             b.ID,
		Name:           b.Name,
		Period:         b.Period,
		Amount:         b.Amount,
		Used:           used,
		Scope:          b.Scope,
		CategoryID:     catID,
		StartDate:      b.StartDate.Format("2006-01-02"),
		EndDate:        b.EndDate.Format("2006-01-02"),
		AlertThreshold: b.AlertThreshold,
		IsAlerted:      b.IsAlerted,
		CreatedAt:      b.CreatedAt.UTC().Format(time.RFC3339),
	}
	if b.CategoryEmoji != nil {
		resp.CategoryEmoji = *b.CategoryEmoji
	}
	resp.CategoryName = catName
	return resp
}

func (s *FinanceService) ListBudgets(ctx context.Context, req *dto.ListBudgetsReq) (*dto.ListBudgetsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	scope := ""
	if req != nil {
		scope = req.Scope
	}
	items, err := dao.Budget.List(ctx, uid, scope)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询预算列表失败")
	}
	out := make([]dto.BudgetResp, 0, len(items))
	for i := range items {
		out = append(out, *budgetToResp(ctx, &items[i]))
	}
	return &dto.ListBudgetsResp{Items: out}, nil
}

func (s *FinanceService) CreateBudget(ctx context.Context, req *dto.CreateBudgetReq) (*dto.BudgetResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, gerror.NewCode(ecode.BudgetNameEmpty)
	}
	if req.Amount <= 0 {
		return nil, gerror.NewCode(ecode.BudgetAmountInvalid)
	}
	period := req.Period
	if period == "" {
		period = model.BudgetPeriodMonthly
	}
	if period != model.BudgetPeriodMonthly && period != model.BudgetPeriodWeekly && period != model.BudgetPeriodYearly {
		return nil, gerror.NewCode(ecode.BudgetPeriodInvalid)
	}

	// 解析日期（如果未传则按 period 自动推算）
	startDate, endDate, err := parseBudgetDates(req.StartDate, req.EndDate, period)
	if err != nil {
		return nil, err
	}

	alertThreshold := req.AlertThreshold
	if alertThreshold <= 0 {
		alertThreshold = 0.80
	}

	// scope 处理：默认 total
	scope := req.Scope
	if scope == "" {
		scope = model.BudgetScopeTotal
	}
	if scope != model.BudgetScopeTotal && scope != model.BudgetScopeCategory {
		return nil, gerror.NewCode(ecode.BudgetScopeInvalid)
	}

	b := &model.Budget{
		ID:             utility.NewID("b"),
		UserID:         uid,
		Name:           name,
		Period:         period,
		Amount:         req.Amount,
		Scope:          scope,
		StartDate:      startDate,
		EndDate:        endDate,
		AlertThreshold: alertThreshold,
	}
	// 分类预算：优先按 category_id（权威），未传 id 时退化为按 name 文本（向后兼容老客户端）
	if scope == model.BudgetScopeCategory {
		catID := strings.TrimSpace(req.CategoryID)
		switch {
		case catID != "":
			cat, err := findActiveCategory(dao.DB.WithContext(ctx), uid, catID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, gerror.NewCode(ecode.BudgetCategoryRequired)
				}
				return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询预算分类失败")
			}
			// 必须是**支出**的**一级**分类（本次不做二级预算，02 §6.4）
			if cat.Scope != model.FinanceCategoryScopeExpense || cat.ParentID != utility.RootCategoryParent {
				return nil, gerror.NewCode(ecode.BudgetCategoryRequired)
			}
			id := cat.ID
			full, emoji := categorySnapshot(cat)
			b.CategoryID = &id
			b.CategoryName = &full
			b.CategoryEmoji = emoji
		case strings.TrimSpace(req.CategoryName) != "":
			catName := strings.TrimSpace(req.CategoryName)
			b.CategoryName = &catName
			if catEmoji := strings.TrimSpace(req.CategoryEmoji); catEmoji != "" {
				b.CategoryEmoji = &catEmoji
			}
		default:
			return nil, gerror.NewCode(ecode.BudgetCategoryRequired)
		}
	}
	if err := dao.Budget.Create(ctx, b); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建预算失败")
	}
	return budgetToResp(ctx, b), nil
}

func (s *FinanceService) UpdateBudget(ctx context.Context, id string, req *dto.UpdateBudgetReq) (*dto.BudgetResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Budget.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.BudgetNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询预算失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.BudgetAccessDenied)
	}

	updates := map[string]any{}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" {
			return nil, gerror.NewCode(ecode.BudgetNameEmpty)
		}
		updates["name"] = n
	}
	if req.Amount != nil {
		if *req.Amount <= 0 {
			return nil, gerror.NewCode(ecode.BudgetAmountInvalid)
		}
		updates["amount"] = *req.Amount
	}
	if req.AlertThreshold != nil {
		updates["alert_threshold"] = *req.AlertThreshold
	}
	if req.StartDate != nil {
		d, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(*req.StartDate), time.Local)
		if err != nil {
			return nil, gerror.NewCode(ecode.BudgetDateInvalid)
		}
		updates["start_date"] = d
	}
	if req.EndDate != nil {
		d, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(*req.EndDate), time.Local)
		if err != nil {
			return nil, gerror.NewCode(ecode.BudgetDateInvalid)
		}
		updates["end_date"] = d
	}
	// ⚠️ 20260921 补：此前 UpdateBudgetReq 完全不含分类字段，预算建好之后**改不了分类**（02 §3）
	if exist.Scope == model.BudgetScopeCategory {
		if req.CategoryID != nil {
			catID := strings.TrimSpace(*req.CategoryID)
			if catID == "" {
				updates["category_id"] = nil // 空串 = 清空分类（仅解除 id 关联）
			} else {
				cat, err := findActiveCategory(dao.DB.WithContext(ctx), uid, catID)
				if err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return nil, gerror.NewCode(ecode.BudgetCategoryRequired)
					}
					return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询预算分类失败")
				}
				if cat.Scope != model.FinanceCategoryScopeExpense || cat.ParentID != utility.RootCategoryParent {
					return nil, gerror.NewCode(ecode.BudgetCategoryRequired)
				}
				full, emoji := categorySnapshot(cat)
				updates["category_id"] = cat.ID
				updates["category_name"] = full
				updates["category_emoji"] = emoji
			}
		} else if req.CategoryName != nil || req.CategoryEmoji != nil {
			// 向后兼容：老客户端只按文本改
			if req.CategoryName != nil {
				n := strings.TrimSpace(*req.CategoryName)
				if n == "" {
					updates["category_name"] = nil
				} else {
					updates["category_name"] = n
				}
			}
			if req.CategoryEmoji != nil {
				e := strings.TrimSpace(*req.CategoryEmoji)
				if e == "" {
					updates["category_emoji"] = nil
				} else {
					updates["category_emoji"] = e
				}
			}
		}
	}
	if len(updates) == 0 {
		return budgetToResp(ctx, exist), nil
	}
	if err := dao.Budget.Update(ctx, id, updates); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新预算失败")
	}
	fresh, err := dao.Budget.GetByID(ctx, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询预算失败")
	}
	return budgetToResp(ctx, fresh), nil
}

func (s *FinanceService) DeleteBudget(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Budget.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.BudgetNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询预算失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return gerror.NewCode(ecode.BudgetAccessDenied)
	}
	if err := dao.Budget.Delete(ctx, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除预算失败")
	}
	return nil
}

// parseDate 解析日期字符串（YYYY-MM-DD），如果为空则根据 period 自动推算
func parseBudgetDates(startDateStr, endDateStr, period string) (time.Time, time.Time, error) {
	if startDateStr != "" && endDateStr != "" {
		sd, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(startDateStr), time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, gerror.NewCode(ecode.BudgetDateInvalid)
		}
		ed, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(endDateStr), time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, gerror.NewCode(ecode.BudgetDateInvalid)
		}
		if ed.Before(sd) {
			return time.Time{}, time.Time{}, gerror.NewCode(ecode.BudgetDateInvalid)
		}
		return sd, ed, nil
	}
	// 自动推算：基于当前日期和 period
	now := time.Now()
	switch period {
	case model.BudgetPeriodWeekly:
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		sd := now.AddDate(0, 0, -(weekday - 1))
		ed := sd.AddDate(0, 0, 6)
		return time.Date(sd.Year(), sd.Month(), sd.Day(), 0, 0, 0, 0, time.Local),
			time.Date(ed.Year(), ed.Month(), ed.Day(), 23, 59, 59, 0, time.Local), nil
	case model.BudgetPeriodYearly:
		return time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.Local),
			time.Date(now.Year(), 12, 31, 23, 59, 59, 0, time.Local), nil
	default: // monthly
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local),
			time.Date(now.Year(), now.Month()+1, 0, 23, 59, 59, 0, time.Local), nil
	}
}

// ====== Transfer ======

func (s *FinanceService) ReverseTransaction(ctx context.Context, id string) (*dto.ReverseTransactionResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	// 查原始交易
	exist, err := dao.Transaction.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.TransactionNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询交易失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.TransactionAccessDenied)
	}
	// 转账不允许冲正
	if exist.Type == model.TransactionTypeTransfer {
		return nil, gerror.NewCode(ecode.TransactionTypeInvalid)
	}
	// 已冲正的交易不允许再次冲正
	if exist.ReversedBy != nil && *exist.ReversedBy != "" {
		return nil, gerror.NewCode(ecode.TransactionAlreadyReversed)
	}

	// 确定反向类型
	var reverseType string
	if exist.Type == model.TransactionTypeExpense {
		reverseType = model.TransactionTypeIncome
	} else {
		reverseType = model.TransactionTypeExpense
	}

	// 构建反向交易
	note := "冲正: " + exist.ID
	reverseTx := &model.Transaction{
		ID:            utility.NewID("tx"),
		UserID:        uid,
		Type:          reverseType,
		Amount:        exist.Amount,
		AccountID:     exist.AccountID,
		AccountName:   exist.AccountName,
		ToAccountID:   exist.ToAccountID,
		ToAccountName: exist.ToAccountName,
		Note:          &note,
		HappenedAt:    time.Now(),
	}
	if exist.CategoryEmoji != nil {
		reverseTx.CategoryEmoji = exist.CategoryEmoji
	}
	if exist.CategoryName != nil {
		reverseTx.CategoryName = exist.CategoryName
	}
	// ⚠️ 刻意**不复制 category_id**：冲正会翻转收支方向（expense ↔ income），
	// 原分类属于另一棵树（06 §2.1 禁止跨 tree），复制过去会造成「id 与 type 不匹配」。
	// 快照名保留，仅用于显示。

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. 插入反向交易
		if err := tx.Create(reverseTx).Error; err != nil {
			return err
		}
		// 2. 原始交易标记 reversed_by
		reverseID := reverseTx.ID
		if err := tx.Model(&model.Transaction{}).Where("id = ?", id).
			Update("reversed_by", reverseID).Error; err != nil {
			return err
		}
		// 3. 反向交易标记 reversed_by（避免对冲正再做冲正）
		if err := tx.Model(&model.Transaction{}).Where("id = ?", reverseID).
			Update("reversed_by", id).Error; err != nil {
			return err
		}
		// 4. 更新账户余额（反向操作）
		var delta float64
		if reverseType == model.TransactionTypeExpense {
			delta = -exist.Amount
		} else {
			delta = exist.Amount
		}
		// 余额不足校验（D24）：仅 asset / investment 拦截；credit 类放行
		var cur struct {
			Balance float64
			Type    string
		}
		if err := tx.Model(&model.Account{}).Where("id = ?", exist.AccountID).
			Select("balance, type").Scan(&cur).Error; err != nil {
			return err
		}
		if utility.AccountCategoryOf(cur.Type) != utility.AccountCategoryCredit && cur.Balance+delta < 0 {
			return gerror.NewCode(ecode.AccountInsufficient)
		}
		if err := tx.Model(&model.Account{}).Where("id = ?", exist.AccountID).
			Update("balance", gorm.Expr("balance + ?", delta)).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if gerror.HasCode(err, &ecode.Success) {
			return nil, err
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "冲正交易失败")
	}

	// 重新查询原始交易（含 reversed_by）
	freshOrig, _ := dao.Transaction.GetByID(ctx, id)

	return &dto.ReverseTransactionResp{
		OriginalTransaction: *transactionToResp(ctx, freshOrig),
		ReverseTransaction:  *transactionToResp(ctx, reverseTx),
	}, nil
}

// ====== Transfer (转账) ======

func (s *FinanceService) Transfer(ctx context.Context, req *dto.TransferReq) (*dto.TransactionResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if req.FromAccountID == "" || req.ToAccountID == "" {
		return nil, gerror.NewCode(ecode.AccountNotFound)
	}
	if req.FromAccountID == req.ToAccountID {
		return nil, gerror.NewCode(ecode.AccountTransferSame)
	}
	if req.Amount <= 0 {
		return nil, gerror.NewCode(ecode.TransactionAmountInvalid)
	}

	happened, err := parseHappenedAt(req.HappenedAt)
	if err != nil {
		return nil, err
	}

	from, err := dao.Account.GetByID(ctx, req.FromAccountID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.AccountNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询转出账户失败")
	}
	if from.UserID != uid {
		return nil, gerror.NewCode(ecode.AccountAccessDenied)
	}
	to, err := dao.Account.GetByID(ctx, req.ToAccountID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.AccountNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询转入账户失败")
	}
	if to.UserID != uid {
		return nil, gerror.NewCode(ecode.AccountAccessDenied)
	}

	note := strings.TrimSpace(req.Note)
	fromID := req.FromAccountID
	toID := req.ToAccountID
	fromName := from.Name
	toName := to.Name
	t := &model.Transaction{
		ID:            utility.NewID("tx"),
		UserID:        uid,
		Type:          model.TransactionTypeTransfer,
		Amount:        req.Amount,
		AccountID:     fromID,
		AccountName:   &fromName,
		ToAccountID:   &toID,
		ToAccountName: &toName,
		HappenedAt:    happened,
	}
	if note != "" {
		t.Note = &note
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. 余额检查（D24）：仅 asset / investment 拦截；credit 类转出放行（余额天然为负）
		var curBal float64
		if err := tx.Model(&model.Account{}).Where("id = ?", fromID).
			Select("balance").Scan(&curBal).Error; err != nil {
			return err
		}
		if utility.AccountCategoryOf(from.Type) != utility.AccountCategoryCredit && curBal-req.Amount < 0 {
			return gerror.NewCode(ecode.AccountInsufficient)
		}
		// 2. 扣 from
		if err := tx.Model(&model.Account{}).Where("id = ?", fromID).
			Update("balance", gorm.Expr("balance - ?", req.Amount)).Error; err != nil {
			return err
		}
		// 3. 加 to
		if err := tx.Model(&model.Account{}).Where("id = ?", toID).
			Update("balance", gorm.Expr("balance + ?", req.Amount)).Error; err != nil {
			return err
		}
		// 4. insert tx
		if err := tx.Create(t).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if gerror.HasCode(err, &ecode.Success) {
			return nil, err
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "转账失败")
	}
	return transactionToResp(ctx, t), nil
}

// ====== 收支日历（260921 v2 批次二） ======

// GetCalendar 收支日历：复用 DAO.GroupByDay，days 只含有记录的日期，summary.net 后端算。
//
// ⚠️ 口径与 v2 一致：income/expense 均排除 exclude_stats=1（已在 GroupByDay 内处理）；
// 转账天然不计入（type 不同）。month 非法 → 400001；范围限制 今年−5~今年+1。
func (s *FinanceService) GetCalendar(ctx context.Context, req *dto.CalendarReq) (*dto.CalendarResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	// month 校验 YYYY-MM（非法 → 400001）；缺省取当月
	m := strings.TrimSpace(req.Month)
	if m == "" {
		m = time.Now().Format("2006-01")
	}
	t, err := time.Parse("2006-01", m)
	if err != nil || t.Format("2006-01") != m {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	year, month := t.Year(), int(t.Month())
	// 范围限制：今年 −5 ~ 今年 +1
	now := time.Now()
	if year < now.Year()-5 || year > now.Year()+1 {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 1, 0)

	dayRows, err := dao.Transaction.GroupByDay(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "统计收支日历失败")
	}
	resp := &dto.CalendarResp{Month: m, Days: make([]dto.CalendarDay, 0, len(dayRows))}
	var sumInc, sumExp float64
	for _, d := range dayRows {
		resp.Days = append(resp.Days, dto.CalendarDay{Date: d.Date, Income: d.Income, Expense: d.Expense})
		sumInc += d.Income
		sumExp += d.Expense
	}
	resp.Summary = dto.CalendarSummary{Income: sumInc, Expense: sumExp, Net: sumInc - sumExp}
	return resp, nil
}

// ====== 债权债务（260921 v4 批次三） ======

// GetDebts 债权债务聚合：后端按 person + source 归并（前端 /transactions 分页，本地聚合会被截断）。
//
// 归属：reimburse + lend → 别人欠我（owed_to_me）；borrow → 我欠别人（i_owe）；
// net = Σowed_to_me − Σi_owe。已结清（open ≤ 0.005）由 DAO 的 HAVING 过滤，不返回。
func (s *FinanceService) GetDebts(ctx context.Context) (*dto.DebtsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	rows, err := dao.Transaction.SumDebts(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "统计债权债务失败")
	}
	owedMap := map[string]*dto.DebtItem{}
	ioweMap := map[string]*dto.DebtItem{}
	resp := &dto.DebtsResp{}
	var net float64
	addItem := func(m map[string]*dto.DebtItem, r dao.DebtRow) {
		item, ok := m[r.Person]
		if !ok {
			item = &dto.DebtItem{Contact: r.Person, Kinds: []string{}}
			m[r.Person] = item
		}
		item.Open += r.Open
		item.Count += int(r.Cnt)
		if !debtKindExists(item.Kinds, r.Source) {
			item.Kinds = append(item.Kinds, r.Source)
		}
	}
	for _, r := range rows {
		if r.Source == model.TxSourceBorrow {
			addItem(ioweMap, r)
			net -= r.Open
		} else {
			// reimburse / lend → 别人欠我
			addItem(owedMap, r)
			net += r.Open
		}
	}
	for _, v := range owedMap {
		resp.OwedToMe = append(resp.OwedToMe, *v)
	}
	for _, v := range ioweMap {
		resp.IOwe = append(resp.IOwe, *v)
	}
	resp.Net = net
	return resp, nil
}

// debtKindExists 判断 source 是否已在 kinds 中（去重）
func debtKindExists(kinds []string, k string) bool {
	for _, x := range kinds {
		if x == k {
			return true
		}
	}
	return false
}

// ====== 流水页顶部数据块（20260922，06 §2） ======

// GetFinanceSummary 自然周期收支汇总 + 总预算聚合（一次请求喂 4 个数，避免前端多处算口径）。
//
//   - period ∈ week|month|year（缺省 month；非法 → ValidationFailed 400001，不新增错误码）；
//   - 周期区间推算与预算 used 滚动**共用同一函数** parseBudgetDates（周一为周首，
//     weekday==0→7），三处口径全仓唯一（01 §2.3 / 06 §1.2 一致性要求）；
//   - income / expense 走 dao.Transaction.SumByType —— 其天然过滤 exclude_stats=0，
//     type 只取 income/expense（**不含 transfer**）；DAO 边界为 happened_at < end（右开），
//     而推算终点是当日 23:59:59，故查询上界 +1 秒，避免最后 1 秒的记录丢失；
//   - budget.* 只统计 scope=total 且 period 与请求匹配（week↔weekly…）的预算
//     （D8：混入分类预算会重复计算）；used 经 budgetToResp 按当前期滚动，
//     与 GET /budgets **同源同值**；无匹配 → count=0、三个数值均 0（前端显示「未设预算」）。
func (s *FinanceService) GetFinanceSummary(ctx context.Context, req *dto.FinanceSummaryReq) (*dto.FinanceSummaryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	period := "month"
	if req != nil {
		if p := strings.TrimSpace(req.Period); p != "" {
			period = p
		}
	}
	// 请求周期（week|month|year）→ 预算 period 常量（weekly|monthly|yearly）
	var budgetPeriod string
	switch period {
	case "week":
		budgetPeriod = model.BudgetPeriodWeekly
	case "month":
		budgetPeriod = model.BudgetPeriodMonthly
	case "year":
		budgetPeriod = model.BudgetPeriodYearly
	default:
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	start, end, err := parseBudgetDates("", "", budgetPeriod)
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	queryEnd := end.Add(time.Second) // SumByType 右开区间，含进终点秒

	income, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeIncome, start, queryEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "统计收入合计失败")
	}
	expense, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeExpense, start, queryEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "统计支出合计失败")
	}

	resp := &dto.FinanceSummaryResp{
		Period:    period,
		StartDate: start.Format("2006-01-02"),
		EndDate:   end.Format("2006-01-02"),
		Income:    income,
		Expense:   expense,
		Net:       income - expense, // 后端算净结余，避免前端两处减法
	}

	budgets, err := dao.Budget.List(ctx, uid, model.BudgetScopeTotal)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询预算列表失败")
	}
	for i := range budgets {
		b := &budgets[i]
		if b.Period != budgetPeriod {
			continue // 只聚合与请求周期一致的总预算（D8）
		}
		br := budgetToResp(ctx, b) // 与 GET /budgets 同源（含 used 按当前期滚动）
		resp.Budget.Count++
		resp.Budget.Amount += br.Amount
		resp.Budget.Used += br.Used
	}
	resp.Budget.Remaining = resp.Budget.Amount - resp.Budget.Used
	return resp, nil
}
