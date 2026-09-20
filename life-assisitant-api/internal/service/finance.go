// Package service 记账服务接口
// 业务校验、跨 DAO 编排（事务）在这里完成
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IFinanceService 记账服务
// MVP 范围：Account CRUD + Transaction CRUD + Transfer + 总余额 + Budget CRUD
type IFinanceService interface {
	// ====== 账户 ======
	ListAccounts(ctx context.Context) (*dto.ListAccountsResp, error)
	GetTotalBalance(ctx context.Context) (*dto.TotalBalanceResp, error)
	CreateAccount(ctx context.Context, req *dto.CreateAccountReq) (*dto.AccountResp, error)
	UpdateAccount(ctx context.Context, id string, req *dto.UpdateAccountReq) (*dto.AccountResp, error)
	DeleteAccount(ctx context.Context, id string) error

	// ====== 交易 ======
	ListTransactions(ctx context.Context, req *dto.ListTransactionsReq) (*dto.ListTransactionsResp, error)
	GetTransaction(ctx context.Context, id string) (*dto.TransactionResp, error)
	CreateTransaction(ctx context.Context, req *dto.CreateTransactionReq) (*dto.TransactionResp, error)
	UpdateTransaction(ctx context.Context, id string, req *dto.UpdateTransactionReq) (*dto.TransactionResp, error)
	DeleteTransaction(ctx context.Context, id string) error

	// ====== 转账 ======
	// Transfer 事务内：1) 创建 transfer 交易 2) 扣 from 余额 3) 加 to 余额
	Transfer(ctx context.Context, req *dto.TransferReq) (*dto.TransactionResp, error)

	// ====== 冲正 ======
	// ReverseTransaction 冲正交易：创建一笔反向交易（expense→income / income→expense），原始交易保留
	ReverseTransaction(ctx context.Context, id string) (*dto.ReverseTransactionResp, error)

	// ====== 预算 ======
	ListBudgets(ctx context.Context, req *dto.ListBudgetsReq) (*dto.ListBudgetsResp, error)
	CreateBudget(ctx context.Context, req *dto.CreateBudgetReq) (*dto.BudgetResp, error)
	UpdateBudget(ctx context.Context, id string, req *dto.UpdateBudgetReq) (*dto.BudgetResp, error)
	DeleteBudget(ctx context.Context, id string) error
}
