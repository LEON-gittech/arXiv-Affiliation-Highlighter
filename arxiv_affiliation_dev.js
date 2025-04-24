// ==UserScript==
// @name         arXiv Affiliation Highlighter (Debug, Progress & Stop Button)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  在页面上的 arXiv 链接旁自动标注论文机构列表，遇错即停，并打印进度与调试信息，可手动停止
// @author       Zezhou Wang <zzw.cs@smail.nju.edu.cn>
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      arxiv.org
// @connect      api.openai.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.8.162/pdf.min.js
// ==/UserScript==

;(async function() {
    'use strict';
  
    // —— 配置区 ——
    // —— API Key 读取与弹窗 ——
    let OPENAI_API_KEY = GM_getValue('OPENAI_API_KEY', '');
    if (!OPENAI_API_KEY) {
      OPENAI_API_KEY = prompt('Please enter your OpenAI API Key:');
      if (OPENAI_API_KEY) {
        GM_setValue('OPENAI_API_KEY', OPENAI_API_KEY);
      } else {
        alert('No OpenAI API Key provided — script will stop.');
        return;
      }
    }
    const MODEL = 'gpt-4o-mini';
    const CACHE_KEY = 'arxivAffCache';
    const CACHE_TTL = 1000 * 60 * 60 * 24 * 365; // 365 天
  
    // PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.8.162/pdf.worker.min.js';
  
    // —— 全局状态 ——
    let shouldStop = false;
  
    // —— 创建调试面板与 Stop 按钮 ——
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      width: '320px',
      maxHeight: '240px',
      zIndex: 9999,
      fontFamily: 'monospace',
    });
    document.body.appendChild(container);
  
    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop Script';
    Object.assign(stopBtn.style, {
      width: '100%',
      padding: '4px',
      marginBottom: '4px',
      background: '#c00',
      color: '#fff',
      border: 'none',
      borderRadius: '3px',
      cursor: 'pointer',
    });
    stopBtn.onclick = () => {
      shouldStop = true;
      logDebug('🛑 用户已停止脚本');
    };
    container.appendChild(stopBtn);
  
    const debugPanel = document.createElement('pre');
    debugPanel.id = 'aff-debug-panel';
    Object.assign(debugPanel.style, {
      width: '100%',
      height: '200px',
      overflowY: 'auto',
      background: 'rgba(0,0,0,0.7)',
      color: '#0f0',
      padding: '8px',
      fontSize: '12px',
      whiteSpace: 'pre-wrap',
    });
    container.appendChild(debugPanel);
  
    function logDebug(msg) {
      const ts = new Date().toISOString();
      console.log(`[AffHighlighter][${ts}] ${msg}`);
      debugPanel.textContent += `[${ts}] ${msg}\n`;
      const lines = debugPanel.textContent.split('\n');
      if (lines.length > 120) {
        debugPanel.textContent = lines.slice(-120).join('\n');
      }
    }
  
    // 注册清理缓存命令
    GM_registerMenuCommand('🗑 清空 arXiv 机构缓存', () => {
      GM_setValue(CACHE_KEY, {});
      alert('已清空 arXiv 机构缓存');
      logDebug('缓存已清空');
    });
  
    // 加载缓存
    let cache = GM_getValue(CACHE_KEY, {});
    logDebug('脚本启动，缓存加载完毕');
  
    // 找到所有 arXiv 链接
    const links = Array.from(
      document.querySelectorAll('a[href*="arxiv.org/abs/"], a[href*="arxiv.org/pdf/"]')
    );
    const total = links.length;
    logDebug(`共发现 ${total} 个 arXiv 链接`);
  
    for (let i = 0; i < total; i++) {
      if (shouldStop) return;
  
      const link = links[i];
      const id = extractArxivId(link.href);
      if (!id) {
        logDebug(`跳过无法解析的链接：${link.href}`);
        continue;
      }
  
      // 抓取论文标题
      let title = id;
      try {
        title = await fetchTitle(id);
      } catch (e) {
        logDebug(`⚠️ 标题抓取失败，使用 ID：${id}`);
      }
  
      logDebug(`开始处理 ${i + 1}/${total} → "${title}"`);
  
      try {
        const entry = cache[id];
        if (entry && Date.now() - entry.ts < CACHE_TTL) {
          logDebug(`缓存命中："${title}"`);
          annotate(link, entry.affs);
        } else {
          logDebug(`缓存未命中，下载并解析 PDF："${title}"`);
          const affs = await fetchAndAnnotate(id);
          logDebug(`解析完成："${title}"`);
          annotate(link, affs);
          cache[id] = { affs, ts: Date.now() };
          GM_setValue(CACHE_KEY, cache);
          logDebug(`已缓存："${title}"`);
        }
      } catch (err) {
        logDebug(`❌ 处理失败，脚本停止！"${title}" 错误: ${err.message}`);
        console.error(err);
        return;
      }
    }
  
    logDebug('所有链接处理完毕');
  
    // —— 辅助函数 —— //
  
    function extractArxivId(url) {
      const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([\d\.v]+)/);
      return m ? m[1] : null;
    }
  
    // 用 GM_xmlhttpRequest 下载页面文本
    function gmFetchText(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'text',
          onload: res =>
            res.status === 200 ? resolve(res.response) : reject(new Error(`HTTP ${res.status}`)),
          onerror: () => reject(new Error('Network error')),
        });
      });
    }
  
    // 抓取 arXiv abstract 页面的真实论文标题
    async function fetchTitle(id) {
      const html = await gmFetchText(`https://arxiv.org/abs/${id}`);
      const doc = new DOMParser().parseFromString(html, 'text/html');
  
      // 1) 尝试从 <h1 class="title mathjax">Title: ...</h1> 中提取
      const h1 = doc.querySelector('h1.title');
      if (h1) {
        // 去掉开头的 "Title:" 前缀
        return h1.textContent.replace(/^Title:\s*/i, '').trim();
      }
  
      // 2) 退而求其次，解析 <title> 标签
      const ti = doc.querySelector('title');
      if (ti) {
        // 格式一般是 "Paper Title | arXiv:2401.10935 [cs]"
        const m = ti.textContent.match(/^(.+?)\s*\|/);
        if (m) return m[1].trim();
        return ti.textContent.trim();
      }
  
      // 3) 都没拿到就返回 ID
      return id;
    }
  
    async function fetchAndAnnotate(id) {
      const buffer = await gmFetchPdf(`https://arxiv.org/pdf/${id}.pdf`);
      logDebug(`PDF 下载成功：${id} (${buffer.byteLength} bytes)`);
      const txt = await extractFirstPageText(buffer);
      logDebug(`第一页文本长度：${txt.length}`);
      return await gmOpenAIExtractAffs(txt);
    }
  
    function gmFetchPdf(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'arraybuffer',
          onload: res =>
            res.status === 200 ? resolve(res.response) : reject(new Error(`PDF 下载失败：${res.status}`)),
          onerror: () => reject(new Error('PDF 下载错误')),
        });
      });
    }
  
    async function extractFirstPageText(buffer) {
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      return content.items.map(i => i.str).join(' ');
    }
  
    function gmOpenAIExtractAffs(text) {
      const prompt = `
  Here is an example to illustrate the desired output format:
  
  Example input (paper first page snippet):
  "Alice is from Tsinghua University; Bob is from Peking University; Carol is also from Tsinghua University."
  
  Example output (one institution per line):
  Tsinghua University
  Peking University
  
  Now please:
  1) Extract all author affiliations from the first page text below.
  2) Output one affiliation per line, with no numbering or extra commentary.
  3) Ensure each institution appears only once (deduplication will also be applied in the script).
  
  First page text:
  ${text}
  
  Please start listing the affiliations, one per line:`;
  
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: 'https://api.openai.com/v1/chat/completions',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          data: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
          }),
          responseType: 'json',
          onload: res => {
            if (res.status === 200) {
              try {
                const lines = res.response.choices[0].message.content
                  .split('\n')
                  .map(l => l.trim())
                  .filter(l => l);
                resolve(Array.from(new Set(lines)));
              } catch {
                reject(new Error('Failed to parse GPT response'));
              }
            } else {
              reject(new Error(`OpenAI request failed: ${res.status}`));
            }
          },
          onerror: () => reject(new Error('Network error during OpenAI request')),
        });
      });
    }
  
    function annotate(linkEl, affs) {
      if (!affs || !affs.length) return;
      const span = document.createElement('span');
      span.textContent = affs.join(', ');
      span.style.cssText = `
        background: #fffbdd;
        color: #333;
        padding: 2px 4px;
        margin-left: 6px;
        border-radius: 3px;
        font-size: 90%;
        font-family: sans-serif;
      `;
      linkEl.after(span);
    }
  
  })();
  