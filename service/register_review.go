/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

package service

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// IsRegisterReviewer 判断指定用户是否为注册审核员。
//
// 审核员名单为换行分隔的用户 ID 列表，同时兼容逗号分隔。
// 名单内用户无需管理员角色即可访问审核界面并执行批准/驳回。
func IsRegisterReviewer(userId int) bool {
	return isIdInList(common.RegisterReviewWhitelist, userId)
}

// IsRegisterReviewAdmin 判断用户是否可访问审核界面：审核员或管理员（含 root）。
func IsRegisterReviewAdmin(userId int, role int) bool {
	if role >= common.RoleAdminUser {
		return true
	}
	return IsRegisterReviewer(userId)
}

// isIdInList 判断 userId 是否出现在换行/逗号分隔的 ID 名单中。
func isIdInList(raw string, userId int) bool {
	if userId <= 0 {
		return false
	}
	target := strconv.Itoa(userId)
	for _, line := range strings.Split(raw, "\n") {
		for _, item := range strings.Split(line, ",") {
			if strings.TrimSpace(item) == target {
				return true
			}
		}
	}
	return false
}

// GetRegisterReviewDiscordGuildIds 解析需要展示的 Discord 服务器 ID 列表，已去重。
func GetRegisterReviewDiscordGuildIds() []string {
	return splitIdList(common.RegisterReviewDiscordGuildIds)
}

// splitIdList 按换行/逗号切分并去重，忽略空项。
func splitIdList(raw string) []string {
	var ids []string
	seen := make(map[string]struct{})
	for _, line := range strings.Split(raw, "\n") {
		for _, item := range strings.Split(line, ",") {
			id := strings.TrimSpace(item)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	return ids
}
