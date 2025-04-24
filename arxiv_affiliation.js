// ==UserScript==
// @name         arXiv Affiliation Highlighter
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  在页面上的 arXiv 链接旁自动标注论文机构列表
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
  
    // 注册清理缓存命令
    GM_registerMenuCommand('🗑 清空 arXiv 机构缓存', () => {
      GM_setValue(CACHE_KEY, {});
      alert('已清空 arXiv 机构缓存');
    });
  
    // 加载缓存
    let cache = GM_getValue(CACHE_KEY, {});
  
    // 找到所有 arXiv 链接
    const links = Array.from(
      document.querySelectorAll('a[href*="arxiv.org/abs/"], a[href*="arxiv.org/pdf/"]')
    );
  
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const id = extractArxivId(link.href);
      if (!id) {
        continue;
      }
  
      // 抓取论文标题
      let title = id;
      try {
        title = await fetchTitle(id);
      } catch (e) {
        // 标题抓取失败，使用 ID
      }
  
      try {
        const entry = cache[id];
        if (entry && Date.now() - entry.ts < CACHE_TTL) {
          annotate(link, entry.affs);
        } else {
          const affs = await fetchAndAnnotate(id);
          annotate(link, affs);
          cache[id] = { affs, ts: Date.now() };
          GM_setValue(CACHE_KEY, cache);
        }
      } catch (err) {
        console.error(err);
        continue;
      }
    }
  
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
      const txt = await extractFirstPageText(buffer);
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
  