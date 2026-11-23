import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function getPreviewUrl () {
  const edgeoneDir = path.join(os.homedir(), '.edgeone')
  let token = process.env.EDGEONE_PAGES_API_TOKEN || ''

  if (!token && fs.existsSync(edgeoneDir)) {
    for (const file of fs.readdirSync(edgeoneDir)) {
      try {
        const full = path.join(edgeoneDir, file)
        const content = fs.readFileSync(full, 'utf8')
        const json = JSON.parse(content)
        if (json.key === 'eo_token' && json.value?.Token) {
          token = json.value.Token
          break
        }
      } catch {}
    }
  }

  if (!token) {
    console.error('❌ 未找到本地 EdgeOne 登录凭证，请先执行 edgeone login')
    process.exit(1)
  }

  const projectConfigPath = path.resolve('.edgeone/project.json')
  let projectName = 'functions-kv'
  if (fs.existsSync(projectConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'))
      projectName = cfg.Name || projectName
    } catch {}
  }

  const apiEndpoint = 'https://pages-api.cloud.tencent.com/v1'
  const projRes = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      Action: 'DescribePagesProjects',
      ProjectIds: [],
      Filters: [{ Name: 'Name', Values: [projectName] }]
    })
  }).then(r => r.json())

  const project = projRes?.Data?.Response?.Projects?.[0]
  if (!project) {
    console.error(`❌ 未找到项目: ${projectName}`)
    process.exit(1)
  }

  const domain = project.PresetDomain || `${projectName}.edgeone.site`

  const signRes = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      Action: 'DescribePagesEncipherToken',
      Text: domain
    })
  }).then(r => r.json())

  const tokenData = signRes?.Data?.Response
  if (!tokenData?.Token || !tokenData?.Timestamp) {
    console.error('❌ 获取签名 Token 失败:', signRes)
    process.exit(1)
  }

  const signedUrl = `https://${domain}/?eo_token=${tokenData.Token}&eo_time=${tokenData.Timestamp}`
  const adminUrl = `https://${domain}/admin.html?eo_token=${tokenData.Token}&eo_time=${tokenData.Timestamp}`

  console.log('\n======================================================')
  console.log('🎉 成功生成 EdgeOne Pages 签名预览链接（有效期约 3 小时）：')
  console.log(`📌 首页预览: \x1b[36m${signedUrl}\x1b[0m`)
  console.log(`🔐 管理后台: \x1b[32m${adminUrl}\x1b[0m`)
  console.log('======================================================\n')
}

getPreviewUrl().catch(err => {
  console.error('获取预览链接出错:', err.message)
  process.exit(1)
})
