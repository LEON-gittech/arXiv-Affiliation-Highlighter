<!--
 * @Author: LEON leon.kepler@bytedance.com
 * @Date: 2025-04-24 16:47:10
 * @LastEditors: LEON leon.kepler@bytedance.com
 * @LastEditTime: 2025-04-24 16:47:19
 * @FilePath: /arxiv_affiliation_highlighter/README.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# 🎉 arXiv Affiliation Highlighter (Debug & Progress & Stop Button)

**作者：** Zezhou Wang (<zzw.cs@smail.nju.edu.cn>)  
**版本：** v1.4  
**说明：** 在任意网页上自动识别并标注 arXiv 论文链接的作者机构，带缓存、日志面板、进度提示、停止按钮及 API Key 弹窗。

---

## 🚀 功能亮点

- 🕵️‍♂️ **智能识别**：扫描所有 `arxiv.org/abs/` 与 `arxiv.org/pdf/` 链接，自动下载并解析 PDF 第 1 页  
- 🏷️ **标注机构**：调用 OpenAI GPT 模型，按行提取、去重机构列表，显示在链接旁  
- 💾 **本地缓存**：所有解析结果保留 365 天，避免重复请求  
- 📝 **调试面板**：页面右下角实时打印详细日志与脚本进度  
- 🛑 **手动停止**：一键点击 “Stop Script” 按钮即可立即终止脚本执行  
- 🔑 **弹窗输入 API Key**：首次运行时弹出提示框，让你安全输入并存储 OpenAI API Key，告别硬编码  

---

## 📦 安装步骤

1. **安装 Tampermonkey**  
   - Chrome / Firefox / Edge 等浏览器插件市场搜索 “Tampermonkey” 并安装。  
2. **新建油猴脚本**  
   - 点击 Tampermonkey 图标 → “创建新脚本”  
   - 将完整脚本内容复制粘贴到编辑器（已移除硬编码 API Key 部分）  
3. **授权域名与权限**  
   - 脚本顶部已声明对 `arxiv.org` 与 `api.openai.com` 的跨域请求权限  
4. **首次运行**  
   - 打开任意包含 arXiv 链接的页面，会弹出输入框提示填写 OpenAI API Key  
   - 输入后脚本自动缓存，后续页面将无需重复输入  

---

## 📖 使用说明

1. **页面加载**  
   - 脚本会立即扫描所有 arXiv 链接并开始串行处理  
2. **查看日志**  
   - 右下角半透明黑底面板会显示：  
     - 🔍 当前链接序号 / 总数  
     - 📥 PDF 下载成功、字节数  
     - 📝 文本长度  
     - ✅ 解析完成或缓存命中  
     - ❌ 错误原因  
3. **停止脚本**  
   - 点击日志面板上方的 **Stop Script** 按钮，脚本将立即中止  
4. **清理缓存**  
   - 在 Tampermonkey 菜单内（右上角扩展图标）选择 **“🗑 清空 arXiv 机构缓存”**  

---

## ⚙️ 脚本结构

```text
┌─────────────────────────────────────────┐
│ ==UserScript==                         │
│ @name   Affiliation Highlighter        │
│ @author Zezhou Wang                   │
│ …                                      │
└─────────────────────────────────────────┘
  ↓
1. API Key 读取与弹窗  
2. 配置：模型、缓存键、TTL  
3. 初始化 PDF.js worker & 全局状态  
4. 创建“Stop Script”按钮 & 调试面板  
5. 注册“清空缓存”命令  
6. 串行扫描并处理 arXiv 链接：  
   └─ fetchTitle → fetchAndAnnotate → annotate  
7. 辅助：gmFetchText/gmFetchPdf/parseTitle/gmOpenAIExtractAffs  
