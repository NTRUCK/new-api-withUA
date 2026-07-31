package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestIsProtectedViolationUser(t *testing.T) {
	tests := []struct {
		userId int
		role   int
		want   bool
	}{
		{userId: 1, role: common.RoleCommonUser, want: true},
		{userId: 2, role: common.RoleAdminUser, want: true},
		{userId: 3, role: common.RoleRootUser, want: true},
		{userId: 4, role: common.RoleCommonUser, want: false},
	}
	for _, tt := range tests {
		if got := isProtectedViolationUser(tt.userId, tt.role); got != tt.want {
			t.Fatalf("isProtectedViolationUser(%d, %d) = %v, want %v", tt.userId, tt.role, got, tt.want)
		}
	}
}
