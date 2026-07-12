package controller

import (
	"html/template"
	"net/http"
	"os"
	"strconv"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

const monitorSessionKey = "monitor_authed"

func monitorPassword() string {
	return os.Getenv("MONITOR_PASSWORD")
}

func MonitorPage(c *gin.Context) {
	passwordSet := monitorPassword() != ""
	authed, _ := sessions.Default(c).Get(monitorSessionKey).(bool)
	if !passwordSet || !authed {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(monitorLoginHTML(passwordSet)))
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(monitorHTML))
}

func MonitorLogin(c *gin.Context) {
	password := monitorPassword()
	if password == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未设置 MONITOR_PASSWORD，监控页已禁用"})
		return
	}
	if c.PostForm("password") != password {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "密码错误"})
		return
	}
	session := sessions.Default(c)
	session.Set(monitorSessionKey, true)
	_ = session.Save()
	c.Redirect(http.StatusFound, "/watching")
}

func MonitorLogout(c *gin.Context) {
	session := sessions.Default(c)
	session.Delete(monitorSessionKey)
	_ = session.Save()
	c.Redirect(http.StatusFound, "/watching")
}

func MonitorUsers(c *gin.Context) {
	if !monitorAuthed(c) {
		return
	}
	users, err := model.GetMonitorUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": users})
}

func MonitorContents(c *gin.Context) {
	if !monitorAuthed(c) {
		return
	}
	userId, _ := strconv.Atoi(c.Query("user_id"))
	if userId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "user_id required"})
		return
	}
	items, err := model.GetMonitorContents(userId, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

func monitorAuthed(c *gin.Context) bool {
	if monitorPassword() == "" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "未设置 MONITOR_PASSWORD，监控页已禁用"})
		return false
	}
	authed, _ := sessions.Default(c).Get(monitorSessionKey).(bool)
	if !authed {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录"})
		return false
	}
	return true
}

func monitorLoginHTML(passwordSet bool) string {
	message := "请输入监控页密码"
	if !passwordSet {
		message = "未设置 MONITOR_PASSWORD，监控页已禁用"
	}
	return `<!doctype html><html><head><meta charset="utf-8"><title>公益站内容监控</title><style>` + monitorCSS + `</style></head><body><main class="login"><h1>公益站内容监控</h1><p>` + template.HTMLEscapeString(message) + `</p><form method="post" action="/watching/login"><input type="password" name="password" placeholder="密码" autofocus><button type="submit">登录</button></form></main></body></html>`
}

const monitorCSS = `
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0}button,input,select{font:inherit}.login{width:360px;max-width:calc(100vw - 48px);margin:18vh auto;padding:28px;background:#111827;border:1px solid #334155;border-radius:14px}.login input{width:100%;box-sizing:border-box;margin:16px 0;padding:12px;border-radius:10px;border:1px solid #475569;background:#020617;color:#e2e8f0}.login button,.top button{padding:10px 16px;border:0;border-radius:10px;background:#2563eb;color:white;cursor:pointer}.app{display:grid;grid-template-columns:320px 1fr;min-height:100vh}.side{border-right:1px solid #334155;background:#111827;padding:18px;overflow:auto}.main{padding:18px;overflow:auto}.user{padding:12px;border:1px solid #334155;border-radius:10px;margin-bottom:10px;cursor:pointer}.user:hover,.user.active{background:#1e293b}.muted{color:#94a3b8;font-size:12px}.item{border:1px solid #334155;border-radius:12px;margin-bottom:16px;background:#111827}.meta{padding:12px 14px;border-bottom:1px solid #334155;color:#cbd5e1}.cols{display:grid;grid-template-columns:1fr 1fr}.box{padding:14px;min-width:0}.box:first-child{border-right:1px solid #334155}.box h3{margin:0 0 10px}.pre{white-space:pre-wrap;word-break:break-word;background:#020617;border-radius:10px;padding:12px;max-height:520px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}a{color:#93c5fd}@media(max-width:900px){.app{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid #334155}.cols{grid-template-columns:1fr}.box:first-child{border-right:0;border-bottom:1px solid #334155}}`

const monitorHTML = `<!doctype html><html><head><meta charset="utf-8"><title>公益站内容监控</title><style>` + monitorCSS + `</style></head><body><div class="app"><aside class="side"><div class="top"><h2>用户</h2><a href="/watching/logout">退出</a></div><div id="users" class="muted">加载中...</div></aside><main class="main"><div class="top"><h1>最近20条输入输出</h1><button onclick="loadUsers()">刷新</button></div><div id="items" class="muted">请选择左侧用户</div></main></div><script>
let currentUser=0;
function esc(s){return String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function time(ts){return new Date(ts*1000).toLocaleString();}
async function loadUsers(){const r=await fetch('/watching/api/users');const j=await r.json();const el=document.getElementById('users');if(!j.success){el.textContent=j.message;return}if(!j.data||!j.data.length){el.textContent='暂无记录';return}el.innerHTML=j.data.map(u=>'<div class="user '+(u.user_id===currentUser?'active':'')+'" onclick="loadItems('+u.user_id+')"><b>'+esc(u.username||('用户#'+u.user_id))+'</b><div class="muted">'+esc(u.token_name)+' · '+esc(u.model_name)+'</div><div class="muted">'+time(u.created_at)+'</div></div>').join('');if(!currentUser)loadItems(j.data[0].user_id)}
async function loadItems(uid){currentUser=uid;loadUsersNoSelect();const r=await fetch('/watching/api/contents?user_id='+uid);const j=await r.json();const el=document.getElementById('items');if(!j.success){el.textContent=j.message;return}if(!j.data||!j.data.length){el.textContent='暂无记录';return}el.innerHTML=j.data.map(x=>'<section class="item"><div class="meta">'+time(x.created_at)+' · '+esc(x.username)+' · '+esc(x.token_name)+' · '+esc(x.model_name)+'<br><span class="muted">IP '+esc(x.ip)+' · UA '+esc(x.user_agent)+' · RequestID '+esc(x.request_id)+'</span></div><div class="cols"><div class="box"><h3>输入</h3><div class="pre">'+esc(formatJSON(x.request_body))+'</div></div><div class="box"><h3>输出</h3><div class="pre">'+esc(formatJSON(x.response_body))+'</div></div></div></section>').join('')}
async function loadUsersNoSelect(){const r=await fetch('/watching/api/users');const j=await r.json();if(!j.success)return;document.getElementById('users').innerHTML=(j.data||[]).map(u=>'<div class="user '+(u.user_id===currentUser?'active':'')+'" onclick="loadItems('+u.user_id+')"><b>'+esc(u.username||('用户#'+u.user_id))+'</b><div class="muted">'+esc(u.token_name)+' · '+esc(u.model_name)+'</div><div class="muted">'+time(u.created_at)+'</div></div>').join('')}
function formatJSON(s){try{return JSON.stringify(JSON.parse(s),null,2)}catch(e){return s}}
loadUsers();setInterval(()=>{currentUser?loadItems(currentUser):loadUsers()},30000);
</script></body></html>`
