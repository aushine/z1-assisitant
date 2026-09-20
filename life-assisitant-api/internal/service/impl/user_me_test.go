package impl

import (
	"context"
	"reflect"
	"testing"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
)

// fakeUserDao 内存版 UserDao，用于在不连 MySQL 的情况下验证 UpdateMe 行为
type fakeUserDao struct {
	users       map[string]*model.User
	lastUpdates map[string]any // 最近一次 UpdateVersion 的 fields
	lastVersion int            // 最近一次 UpdateVersion 传入的 version
}

func (f *fakeUserDao) WithContext(ctx context.Context) dao.UserDao { return f }
func (f *fakeUserDao) FindByID(ctx context.Context, id string) (*model.User, error) {
	u, ok := f.users[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	cp := *u
	return &cp, nil
}
func (f *fakeUserDao) FindByUsernameOrEmail(ctx context.Context, account string) (*model.User, error) {
	for _, u := range f.users {
		if u.Username == account || u.Email == account {
			cp := *u
			return &cp, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}
func (f *fakeUserDao) FindByIDUnscoped(ctx context.Context, id string) (*model.User, error) {
	return f.FindByID(ctx, id)
}
func (f *fakeUserDao) Create(ctx context.Context, u *model.User) error { f.users[u.ID] = u; return nil }
func (f *fakeUserDao) Update(ctx context.Context, id string, fields map[string]any) error {
	return nil
}
func (f *fakeUserDao) UpdateVersion(ctx context.Context, id string, version int, fields map[string]any) (int64, error) {
	u, ok := f.users[id]
	if !ok || u.Version != version {
		return 0, nil // CAS 失配
	}
	f.lastUpdates = fields
	f.lastVersion = version
	for k, v := range fields {
		switch k {
		case "name":
			u.Name = v.(string)
		case "email":
			u.Email = v.(string)
		case "phone":
			s := v.(string)
			u.Phone = &s
		case "avatar":
			s := v.(string)
			u.Avatar = &s
		case "version":
			u.Version = v.(int)
		case "role_code":
			u.RoleCode = v.(string)
		case "status":
			u.Status = v.(string)
		case "department":
			s := v.(string)
			u.Department = &s
		}
	}
	return 1, nil
}
func (f *fakeUserDao) SoftDelete(ctx context.Context, id string) error { delete(f.users, id); return nil }
func (f *fakeUserDao) List(ctx context.Context, opts dao.UserListOptions) ([]model.User, int64, error) {
	return nil, 0, nil
}
func (f *fakeUserDao) CountByRole(ctx context.Context, roleCode string) (int64, error) { return 0, nil }

func withFakeUserDao(f *fakeUserDao) func() {
	old := dao.User
	dao.User = f
	return func() { dao.User = old }
}

func newFakeUser(id, role string, version int) *model.User {
	return &model.User{ID: id, Username: "u_" + id, Name: "用户" + id, Email: id + "@example.com", RoleCode: role, Status: model.UserStatusActive, Version: version}
}

func strp(s string) *string { return &s }

// (a) 非管理员（user）能成功改自己的资料，且 role/status/department 不变
func TestUpdateMe_NonAdminCanUpdateOwnProfile(t *testing.T) {
	f := &fakeUserDao{users: map[string]*model.User{
		"u1": newFakeUser("u1", model.RoleUser, 0),
	}}
	defer withFakeUserDao(f)()

	us := &UserService{}
	resp, err := us.UpdateMe(context.Background(), "u1", &dto.UpdateMeReq{
		Name:   strp("张三"),
		Avatar: strp("https://example.com/a.png"),
	})
	if err != nil {
		t.Fatalf("viewer 自更新应成功，实际 err=%v", err)
	}
	if resp.Name != "张三" || resp.Avatar != "https://example.com/a.png" {
		t.Fatalf("资料未生效：%+v", resp)
	}
	if resp.Version != 1 {
		t.Fatalf("version 应 +1 为 1，实际 %d", resp.Version)
	}
	if resp.Role != model.RoleUser {
		t.Fatalf("role 不应改变，实际 %s", resp.Role)
	}
	if f.users["u1"].Version != 1 {
		t.Fatalf("库内 version 应为 1，实际 %d", f.users["u1"].Version)
	}
	// updates 里绝不能出现 role/status/department
	for _, forbidden := range []string{"role_code", "status", "department"} {
		if _, ok := f.lastUpdates[forbidden]; ok {
			t.Fatalf("UpdateMe 不应写 %s，updates=%v", forbidden, f.lastUpdates)
		}
	}
}

// (b) 非管理员无法通过该端点改自己的 role：UpdateMeReq 结构上就没有 role 字段
func TestUpdateMeReq_HasNoPrivilegedFields(t *testing.T) {
	typ := reflect.TypeOf(dto.UpdateMeReq{})
	for i := 0; i < typ.NumField(); i++ {
		tag := typ.Field(i).Tag.Get("json")
		for _, forbidden := range []string{"role", "status", "department"} {
			if tag == forbidden {
				t.Fatalf("UpdateMeReq 不应包含字段 %q", forbidden)
			}
		}
	}
}

// version 缺省时用服务端当前 version，不应 400/冲突
func TestUpdateMe_VersionOmittedUsesServerVersion(t *testing.T) {
	f := &fakeUserDao{users: map[string]*model.User{
		"u1": newFakeUser("u1", model.RoleUser, 3),
	}}
	defer withFakeUserDao(f)()

	us := &UserService{}
	resp, err := us.UpdateMe(context.Background(), "u1", &dto.UpdateMeReq{Name: strp("李四")})
	if err != nil {
		t.Fatalf("未携带 version 应成功，实际 err=%v", err)
	}
	if resp.Version != 4 {
		t.Fatalf("应从服务端 version 3 +1 = 4，实际 %d", resp.Version)
	}
	if f.lastVersion != 3 {
		t.Fatalf("CAS 基准应为服务端 version 3，实际 %d", f.lastVersion)
	}
}

// 显式携带过期 version → VersionConflict（乐观锁语义保留）
func TestUpdateMe_StaleVersionReturnsConflict(t *testing.T) {
	f := &fakeUserDao{users: map[string]*model.User{
		"u1": newFakeUser("u1", model.RoleUser, 5),
	}}
	defer withFakeUserDao(f)()

	v := 4
	us := &UserService{}
	_, err := us.UpdateMe(context.Background(), "u1", &dto.UpdateMeReq{Name: strp("王五"), Version: &v})
	if !gerror.HasCode(err, ecode.VersionConflict) {
		t.Fatalf("过期 version 应返回 VERSION_CONFLICT，实际 err=%v", err)
	}
}

// 改 email 与他人冲突 → UserEmailExists
func TestUpdateMe_EmailConflict(t *testing.T) {
	f := &fakeUserDao{users: map[string]*model.User{
		"u1": newFakeUser("u1", model.RoleUser, 0),
		"u2": newFakeUser("u2", model.RoleUser, 0),
	}}
	f.users["u2"].Email = "taken@example.com"
	defer withFakeUserDao(f)()

	us := &UserService{}
	_, err := us.UpdateMe(context.Background(), "u1", &dto.UpdateMeReq{Email: strp("taken@example.com")})
	if !gerror.HasCode(err, ecode.UserEmailExists) {
		t.Fatalf("email 冲突应返回 USER_EMAIL_EXISTS，实际 err=%v", err)
	}
}

// 改成自己的 email（未变化）不视为冲突
func TestUpdateMe_EmailUnchanged(t *testing.T) {
	f := &fakeUserDao{users: map[string]*model.User{
		"u1": newFakeUser("u1", model.RoleUser, 0),
	}}
	defer withFakeUserDao(f)()

	us := &UserService{}
	_, err := us.UpdateMe(context.Background(), "u1", &dto.UpdateMeReq{Email: strp("u1@example.com")})
	if err != nil {
		t.Fatalf("改回自己邮箱不应报冲突，实际 err=%v", err)
	}
}
