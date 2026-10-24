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
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 注册审核用的 Discord 信息查询。
//
// 与 oauth/discord.go 的准入校验不同：那里依赖申请人自己的 OAuth access_token 做即时校验，
// 这里用 Bot Token 离线查询，审核员在申请人不在场时也能看到其服务器成员身份与身份组。

const discordAPIBase = "https://discord.com/api/v10"

var discordHTTPClient = &http.Client{Timeout: 15 * time.Second}

// DiscordRoleInfo Discord 身份组
type DiscordRoleInfo struct {
	Id    string `json:"id"`
	Name  string `json:"name"`
	Color int    `json:"color"`
}

// DiscordGuildMembership 申请人在某个服务器中的成员信息
type DiscordGuildMembership struct {
	GuildId   string            `json:"guild_id"`
	GuildName string            `json:"guild_name"`
	InGuild   bool              `json:"in_guild"`
	Nick      string            `json:"nick"`
	JoinedAt  string            `json:"joined_at"`
	Roles     []DiscordRoleInfo `json:"roles"`
	Error     string            `json:"error,omitempty"`
}

// DiscordLookupResult 申请人的 Discord 查询结果
type DiscordLookupResult struct {
	UserId      string                   `json:"user_id"`
	Username    string                   `json:"username"`
	GlobalName  string                   `json:"global_name"`
	AvatarUrl   string                   `json:"avatar_url"`
	Memberships []DiscordGuildMembership `json:"memberships"`
}

// 服务器元信息缓存（名称 + 身份组表），避免每次审核都重复拉取
type discordGuildMeta struct {
	name    string
	roles   map[string]DiscordRoleInfo
	expires time.Time
}

var (
	discordGuildMetaMu    sync.Mutex
	discordGuildMetaCache = map[string]discordGuildMeta{}
)

const discordGuildMetaTTL = 10 * time.Minute

// LookupDiscordApplicant 查询申请人在配置的 Discord 服务器中的成员与身份组信息。
//
// query 可以是 Discord 数字 ID，也可以是用户名——后者会先在配置的服务器中搜索解析成 ID。
// 未配置 Bot Token 或服务器时返回错误，由调用方转为提示。
func LookupDiscordApplicant(query string) (*DiscordLookupResult, error) {
	return LookupDiscordUserInGuilds(query, GetRegisterReviewDiscordGuildIds())
}

// LookupDiscordUserInGuilds 在指定服务器中查询 Discord 用户的成员与身份组信息。
// query 可以是 Discord 数字 ID 或用户名（用户名会在给定服务器中搜索解析成 ID）。
func LookupDiscordUserInGuilds(query string, guildIds []string) (*DiscordLookupResult, error) {
	token := strings.TrimSpace(common.RegisterReviewDiscordBotToken)
	if token == "" {
		return nil, errors.New("未配置 Discord Bot Token，无法查询")
	}
	if len(guildIds) == 0 {
		return nil, errors.New("未配置需要查询的 Discord 服务器")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("申请人未填写可用的 Discord 信息")
	}

	userId := query
	if !isDiscordSnowflake(query) {
		resolved, err := searchGuildMemberId(guildIds, query, token)
		if err != nil {
			return nil, err
		}
		userId = resolved
	}

	result := &DiscordLookupResult{UserId: userId}

	var discordUser struct {
		Id         string `json:"id"`
		Username   string `json:"username"`
		GlobalName string `json:"global_name"`
		Avatar     string `json:"avatar"`
	}
	if err := doDiscordRequest(http.MethodGet, "/users/"+userId, token, &discordUser); err == nil {
		result.Username = discordUser.Username
		result.GlobalName = discordUser.GlobalName
		if discordUser.Id != "" && discordUser.Avatar != "" {
			result.AvatarUrl = fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png?size=128", discordUser.Id, discordUser.Avatar)
		}
	}

	for _, guildId := range guildIds {
		result.Memberships = append(result.Memberships, lookupGuildMembership(guildId, userId, token))
	}
	return result, nil
}

// lookupGuildMembership 查询单人在单个服务器中的成员信息
func lookupGuildMembership(guildId, userId, token string) DiscordGuildMembership {
	info := DiscordGuildMembership{GuildId: guildId, GuildName: guildId}
	meta := fetchGuildMeta(guildId, token)
	if meta.name != "" {
		info.GuildName = meta.name
	}

	var member struct {
		Nick     string   `json:"nick"`
		JoinedAt string   `json:"joined_at"`
		Roles    []string `json:"roles"`
	}
	if err := doDiscordRequest(http.MethodGet, "/guilds/"+guildId+"/members/"+userId, token, &member); err != nil {
		info.Error = "不在该服务器中或无法查询"
		return info
	}

	info.InGuild = true
	info.Nick = member.Nick
	info.JoinedAt = member.JoinedAt
	for _, roleId := range member.Roles {
		// @everyone 的身份组 ID 与服务器 ID 相同，对审核无参考价值
		if roleId == guildId {
			continue
		}
		if role, ok := meta.roles[roleId]; ok {
			info.Roles = append(info.Roles, role)
		} else {
			info.Roles = append(info.Roles, DiscordRoleInfo{Id: roleId})
		}
	}
	return info
}

// fetchGuildMeta 获取服务器名称与身份组表，带 10 分钟缓存
func fetchGuildMeta(guildId, token string) discordGuildMeta {
	discordGuildMetaMu.Lock()
	if cached, ok := discordGuildMetaCache[guildId]; ok && time.Now().Before(cached.expires) {
		discordGuildMetaMu.Unlock()
		return cached
	}
	discordGuildMetaMu.Unlock()

	meta := discordGuildMeta{roles: map[string]DiscordRoleInfo{}, expires: time.Now().Add(discordGuildMetaTTL)}

	var guild struct {
		Name string `json:"name"`
	}
	if err := doDiscordRequest(http.MethodGet, "/guilds/"+guildId, token, &guild); err == nil {
		meta.name = guild.Name
	}

	var roles []struct {
		Id    string `json:"id"`
		Name  string `json:"name"`
		Color int    `json:"color"`
	}
	if err := doDiscordRequest(http.MethodGet, "/guilds/"+guildId+"/roles", token, &roles); err == nil {
		for _, r := range roles {
			meta.roles[r.Id] = DiscordRoleInfo{Id: r.Id, Name: r.Name, Color: r.Color}
		}
	}

	discordGuildMetaMu.Lock()
	discordGuildMetaCache[guildId] = meta
	discordGuildMetaMu.Unlock()
	return meta
}

// searchGuildMemberId 在配置的服务器中按用户名搜索成员，返回其 Discord ID
func searchGuildMemberId(guildIds []string, query string, token string) (string, error) {
	for _, guildId := range guildIds {
		path := fmt.Sprintf("/guilds/%s/members/search?query=%s&limit=1", guildId, url.QueryEscape(query))
		var members []struct {
			User struct {
				Id string `json:"id"`
			} `json:"user"`
		}
		if err := doDiscordRequest(http.MethodGet, path, token, &members); err != nil {
			continue
		}
		if len(members) > 0 && members[0].User.Id != "" {
			return members[0].User.Id, nil
		}
	}
	return "", errors.New("未在配置的服务器中找到该用户，请让申请人填写 Discord ID")
}

// doDiscordRequest 以 Bot 身份调用 Discord API，out 为 nil 时忽略响应体
func doDiscordRequest(method, path, token string, out any) error {
	req, err := http.NewRequest(method, discordAPIBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bot "+token)
	req.Header.Set("User-Agent", "new-api-register-review/1.0")

	resp, err := discordHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("discord api %s 返回 %d", path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return common.Unmarshal(body, out)
}

// isDiscordSnowflake 判断是否为 Discord ID（17~21 位纯数字）
func isDiscordSnowflake(s string) bool {
	if len(s) < 17 || len(s) > 21 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
