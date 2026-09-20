// Package impl 记账服务实现
// 业务规则：
//   1. 只能操作自己的账户/交易/预算（user_id 从 ctx 取）
//   2. amount 始终为正（用 float64；DB 列 DECIMAL(18,2) 自动精度控制）
//   3. CreateTransaction 事务内：insert tx + 更新账户余额（expense 减、income 加）
//   4. Transfer 事务内：insert transfer tx + 扣 from 余额 + 加 to 余额
//   5. UpdateTransaction：expense/income 改 amount 时，同步账户余额
//   6. DeleteTransaction：expense/income 删时，反向回滚账户余额
//   7. Budget.used 由后端实时从 transactions 计算（不存表）
//   8. 不做：分类管理、附件
package impl

import (
	"context"
	"errors"
	"strings"
	"time"

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
		ID:        a.ID,
		Name:      a.Name,
		Type:      a.Type,
		Icon:      a.Icon,
		Color:     a.Color,
		Balance:   a.Balance,
		CreatedAt: a.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: a.UpdatedAt.UTC().Format(time.RFC3339),
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
	for i := range items {
		out = append(out, *accountToResp(&items[i]))
		total += items[i].Balance
	}
	return &dto.ListAccountsResp{Items: out, TotalBalance: total, Total: len(out)}, nil
}

func (s *FinanceService) GetTotalBalance(ctx context.Context) (*dto.TotalBalanceResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	total, err := dao.Account.GetTotalBalance(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询总余额失败")
	}
	return &dto.TotalBalanceResp{TotalBalance: total}, nil
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
	icon := req.Icon
	if icon == "" {
		icon = "💰"
	}
	color := req.Color
	if color == "" {
		color = "#E0F2FF"
	}

	a := &model.Account{
		ID:      utility.NewID("a"),
		UserID:  uid,
		Name:    name,
		Type:    req.Type,
		Icon:    icon,
		Color:   color,
		Balance: req.Balance,
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
	if req.Balance != nil {
		updates["balance"] = *req.Balance
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
	if err := dao.Account.Update(ctx, id, updates); err != nil {
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
		Page:      page,
		PageSize:  pageSize,
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

	t := &model.Transaction{
		ID:         utility.NewID("tx"),
		UserID:     uid,
		Type:       req.Type,
		Amount:     req.Amount,
		AccountID:  req.AccountID,
		AccountName: &acc.Name,
		HappenedAt: happened,
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

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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
		// 余额不足校验
		var curBal float64
		if err := tx.Model(&model.Account{}).Where("id = ?", req.AccountID).
			Select("balance").Scan(&curBal).Error; err != nil {
			return err
		}
		if curBal+delta < 0 {
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
			// 余额检查
			var curBal float64
			if err := tx.Model(&model.Account{}).Where("id = ?", newAccountID).
				Select("balance").Scan(&curBal).Error; err != nil {
				return err
			}
			if curBal+newDelta < 0 {
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
			if gerror.HasCode(err, &ecode.Success) {
				return nil, err
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新交易失败")
		}
	} else {
		if len(updates) == 0 {
			return transactionToResp(ctx, exist), nil
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

// budgetToResp 将 Budget 实体转为 DTO，并实时计算 used 字段
func budgetToResp(ctx context.Context, b *model.Budget) *dto.BudgetResp {
	var used float64
	if b.Scope == model.BudgetScopeCategory && b.CategoryName != nil {
		used, _ = dao.Budget.SumExpenseByCategory(ctx, b.UserID, *b.CategoryName, b.StartDate, b.EndDate)
	} else {
		used, _ = dao.Budget.SumExpense(ctx, b.UserID, b.StartDate, b.EndDate)
	}
	resp := &dto.BudgetResp{
		ID:             b.ID,
		Name:           b.Name,
		Period:         b.Period,
		Amount:         b.Amount,
		Used:           used,
		Scope:          b.Scope,
		StartDate:      b.StartDate.Format("2006-01-02"),
		EndDate:        b.EndDate.Format("2006-01-02"),
		AlertThreshold: b.AlertThreshold,
		IsAlerted:      b.IsAlerted,
		CreatedAt:      b.CreatedAt.UTC().Format(time.RFC3339),
	}
	if b.CategoryEmoji != nil {
		resp.CategoryEmoji = *b.CategoryEmoji
	}
	if b.CategoryName != nil {
		resp.CategoryName = *b.CategoryName
	}
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
	// 分类预算：设置 category_emoji / category_name
	if scope == model.BudgetScopeCategory {
		if catName := strings.TrimSpace(req.CategoryName); catName != "" {
			b.CategoryName = &catName
		} else {
			return nil, gerror.NewCode(ecode.BudgetCategoryRequired)
		}
		if catEmoji := strings.TrimSpace(req.CategoryEmoji); catEmoji != "" {
			b.CategoryEmoji = &catEmoji
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
		ID:          utility.NewID("tx"),
		UserID:      uid,
		Type:        reverseType,
		Amount:      exist.Amount,
		AccountID:   exist.AccountID,
		AccountName: exist.AccountName,
		ToAccountID: exist.ToAccountID,
		ToAccountName: exist.ToAccountName,
		Note:        &note,
		HappenedAt:  time.Now(),
	}
	if exist.CategoryEmoji != nil {
		reverseTx.CategoryEmoji = exist.CategoryEmoji
	}
	if exist.CategoryName != nil {
		reverseTx.CategoryName = exist.CategoryName
	}

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
		// 余额不足校验
		var curBal float64
		if err := tx.Model(&model.Account{}).Where("id = ?", exist.AccountID).
			Select("balance").Scan(&curBal).Error; err != nil {
			return err
		}
		if curBal+delta < 0 {
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
		ID:          utility.NewID("tx"),
		UserID:      uid,
		Type:        model.TransactionTypeTransfer,
		Amount:      req.Amount,
		AccountID:   fromID,
		AccountName: &fromName,
		ToAccountID: &toID,
		ToAccountName: &toName,
		HappenedAt:  happened,
	}
	if note != "" {
		t.Note = &note
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. 余额检查
		var curBal float64
		if err := tx.Model(&model.Account{}).Where("id = ?", fromID).
			Select("balance").Scan(&curBal).Error; err != nil {
			return err
		}
		if curBal-req.Amount < 0 {
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
