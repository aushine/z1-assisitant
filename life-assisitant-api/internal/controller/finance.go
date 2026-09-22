// Package controller 记账控制器
// 规范：controller 只做参数解析 + 调 service + 返回响应
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// FinanceController 记账控制器（账户 + 交易 + 转账）
type FinanceController struct{}

var Finance = &FinanceController{}

// ====== 账户 ======

// ListAccounts GET /api/v1/accounts
func (c *FinanceController) ListAccounts(r *ghttp.Request) {
	out, err := service.Finance().ListAccounts(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetTotalBalance GET /api/v1/accounts/total
func (c *FinanceController) GetTotalBalance(r *ghttp.Request) {
	out, err := service.Finance().GetTotalBalance(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// CreateAccount POST /api/v1/accounts
func (c *FinanceController) CreateAccount(r *ghttp.Request) {
	var req dto.CreateAccountReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().CreateAccount(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// UpdateAccount PATCH /api/v1/accounts/:id
func (c *FinanceController) UpdateAccount(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateAccountReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().UpdateAccount(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// DeleteAccount DELETE /api/v1/accounts/:id
func (c *FinanceController) DeleteAccount(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.Finance().DeleteAccount(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// ====== 交易 ======

// ListTransactions GET /api/v1/transactions
func (c *FinanceController) ListTransactions(r *ghttp.Request) {
	var req dto.ListTransactionsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().ListTransactions(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	response.Page(r, out.Items, out.Total, page, pageSize)
}

// GetTransaction GET /api/v1/transactions/:id
func (c *FinanceController) GetTransaction(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Finance().GetTransaction(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// CreateTransaction POST /api/v1/transactions
func (c *FinanceController) CreateTransaction(r *ghttp.Request) {
	var req dto.CreateTransactionReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().CreateTransaction(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// UpdateTransaction PATCH /api/v1/transactions/:id
func (c *FinanceController) UpdateTransaction(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateTransactionReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().UpdateTransaction(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// DeleteTransaction DELETE /api/v1/transactions/:id
func (c *FinanceController) DeleteTransaction(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.Finance().DeleteTransaction(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// Transfer POST /api/v1/transactions/transfer
func (c *FinanceController) Transfer(r *ghttp.Request) {
	var req dto.TransferReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().Transfer(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ReverseTransaction POST /api/v1/transactions/:id/reverse
func (c *FinanceController) ReverseTransaction(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Finance().ReverseTransaction(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ====== 预算 ======

// ListBudgets GET /api/v1/budgets
func (c *FinanceController) ListBudgets(r *ghttp.Request) {
	var req dto.ListBudgetsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().ListBudgets(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// CreateBudget POST /api/v1/budgets
func (c *FinanceController) CreateBudget(r *ghttp.Request) {
	var req dto.CreateBudgetReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().CreateBudget(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// UpdateBudget PATCH /api/v1/budgets/:id
func (c *FinanceController) UpdateBudget(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateBudgetReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().UpdateBudget(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// DeleteBudget DELETE /api/v1/budgets/:id
func (c *FinanceController) DeleteBudget(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.Finance().DeleteBudget(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// ====== 收支日历 / 债权债务（260921 v2 + v4） ======

// GetCalendar GET /api/v1/finance/calendar?month=YYYY-MM
func (c *FinanceController) GetCalendar(r *ghttp.Request) {
	var req dto.CalendarReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Finance().GetCalendar(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetDebts GET /api/v1/finance/debts
func (c *FinanceController) GetDebts(r *ghttp.Request) {
	out, err := service.Finance().GetDebts(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
