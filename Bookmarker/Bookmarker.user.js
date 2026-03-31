// ==UserScript==
// @name         网页书签 Markdown 保存器（最接近自动版 v1.8）
// @namespace    https://tampermonkey.net/
// @version      1.8
// @description  点击保存就自动弹出选择器（只需双击上次文件）→ 直接写入本地文件（无下载）
// @author       Grok
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    let bookmarks = GM_getValue('bookmarks', []);
    let currentFilename = GM_getValue('mdFilename', '');
    let fileHandle = null;

    function refreshData() {
        bookmarks = GM_getValue('bookmarks', []);
        currentFilename = GM_getValue('mdFilename', '');
    }

    function getNextNo() {
        return bookmarks.length === 0 ? 1 : Math.max(...bookmarks.map(b => b.no)) + 1;
    }

    function findByUrl(url) {
        return bookmarks.findIndex(b => b.url === url);
    }

    function parseMarkdownTable(mdText) {
        const lines = mdText.split('\n');
        const data = [];
        let inTable = false;
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            if (line.includes('No') && line.includes('Title') && line.includes('链接') && line.includes('remark')) {
                inTable = true; continue;
            }
            if (!inTable || line.startsWith('|-') || line.startsWith('|----')) continue;
            if (line.startsWith('|') && line.endsWith('|')) {
                const cells = line.split('|').map(c => c.trim()).filter(Boolean);
                if (cells.length >= 4) {
                    const no = parseInt(cells[0]) || (data.length + 1);
                    const title = cells[1] || '';
                    const url = cells[2] || '';
                    const remark = cells[3] || '';
                    if (url.startsWith('http')) data.push({ no, title, url, remark });
                }
            }
        }
        return data.sort((a, b) => a.no - b.no);
    }

    function generateMarkdown() {
        let md = '# 我的网页书签\n\n| No | Title | 链接 | remark |\n|----|-------|------|--------|\n';
        bookmarks.sort((a, b) => a.no - b.no).forEach(item => {
            const safeTitle = (item.title || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            const safeRemark = (item.remark || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            md += `| ${item.no} | ${safeTitle} | ${item.url} | ${safeRemark} |\n`;
        });
        return md;
    }

    async function writeToLocalFile(content) {
        if (!fileHandle) throw new Error('未绑定文件');
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = `position: fixed; bottom: 90px; right: 30px; background: #10b981; color: white; padding: 13px 22px; border-radius: 8px; font-size: 14px; z-index: 2147483647; box-shadow: 0 4px 15px rgba(0,0,0,0.3); white-space: pre-line;`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3200);
    }

    async function saveBookmark(isCustom) {
        refreshData();

        if (!fileHandle) {
            if (currentFilename) {
                showToast(`检测到上次文件：${currentFilename}\n\n请在弹出的窗口中**双击**它（1秒完成）`);
            } else {
                showToast('第一次使用，请选择你的 Markdown 文件');
            }
            await selectMarkdownFile();
            if (!fileHandle) {
                showToast('❌ 已取消，未保存');
                return;
            }
        }

        const title = (document.title || '无标题页面').trim();
        const url = window.location.href;
        const index = findByUrl(url);

        if (index !== -1) {
            const existing = bookmarks[index];
            if (!isCustom) {
                alert(`⚠️ 此页面已在书签中！\n\nNo.${existing.no}\n标题：${existing.title}\n备注：${existing.remark || '（空）'}`);
                return;
            }
            const newRemark = prompt(`此链接已存在！\n\n当前备注：\n${existing.remark || '（空）'}\n\n请输入新备注：`, existing.remark || '');
            if (newRemark === null) return;
            existing.remark = (newRemark || '').trim();
            existing.title = title;
        } else {
            let remark = '';
            if (isCustom) {
                remark = prompt('请输入这条书签的备注（可留空）：') || '';
            }
            bookmarks.push({ no: getNextNo(), title, url, remark: remark.trim() });
        }

        GM_setValue('bookmarks', bookmarks);
        const newContent = generateMarkdown();

        try {
            await writeToLocalFile(newContent);
            showToast(`✅ 已**直接写入**本地文件！\n${currentFilename}`);
        } catch (err) {
            console.error(err);
            showToast('⚠️ 写入失败（文件可能被占用）');
        }
    }

    async function selectMarkdownFile() {
        const pickerAPI = unsafeWindow.showOpenFilePicker || window.showOpenFilePicker;
        if (typeof pickerAPI !== 'function') {
            alert('❌ 浏览器不支持直接写入（请使用 Chrome / Edge 最新版）');
            return;
        }

        try {
            const [handle] = await pickerAPI({
                types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown'] } }],
                multiple: false
            });

            fileHandle = handle;
            const file = await handle.getFile();
            const text = await file.text();

            bookmarks = parseMarkdownTable(text);
            currentFilename = file.name;

            GM_setValue('bookmarks', bookmarks);
            GM_setValue('mdFilename', currentFilename);

            showToast(`✅ 已绑定成功！\n文件：${file.name}\n\n以后点击保存只需双击即可`);
        } catch (err) {
            if (err.name !== 'AbortError') alert('绑定失败：' + err.message);
        }
    }

    GM_addStyle(`
        #bookmark-saver { position: fixed; bottom: 30px; right: 30px; z-index: 2147483647; font-family: system-ui, -apple-system, sans-serif; }
        #bookmark-saver-main-btn {
            width: 58px; height: 58px; border-radius: 9999px;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: white; font-size: 28px; font-weight: 700;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 8px 25px rgba(37,99,235,0.45);
            cursor: pointer; transition: all 0.2s ease; border: none;
        }
        #bookmark-saver-main-btn:hover { transform: scale(1.08); box-shadow: 0 12px 30px rgba(37,99,235,0.55); }
        #bookmark-saver-menu {
            position: absolute; bottom: 72px; right: 0; background: #ffffff;
            border: 1px solid #e2e8f0; border-radius: 16px;
            box-shadow: 0 15px 40px rgba(0,0,0,0.18); padding: 10px;
            min-width: 230px; display: none; flex-direction: column; gap: 6px;
        }
        #bookmark-saver-menu button {
            padding: 13px 18px; border: none; background: #f8fafc;
            color: #1e2937; text-align: left; border-radius: 10px;
            font-size: 14.5px; cursor: pointer; transition: all 0.2s ease;
            line-height: 1.4;
        }
        #bookmark-saver-menu button:hover { background: #bae6fd; color: #0369a1; transform: translateX(4px); }
    `);

    function createUI() {
        const container = document.createElement('div');
        container.id = 'bookmark-saver';

        const mainBtn = document.createElement('button');
        mainBtn.id = 'bookmark-saver-main-btn';
        mainBtn.innerHTML = 'B';

        const menu = document.createElement('div');
        menu.id = 'bookmark-saver-menu';

        const btnQuick = document.createElement('button');
        btnQuick.textContent = '🚀 快速保存';
        btnQuick.onclick = () => { menu.style.display = 'none'; saveBookmark(false); };

        const btnCustom = document.createElement('button');
        btnCustom.textContent = '✍️ 自定义保存';
        btnCustom.onclick = () => { menu.style.display = 'none'; saveBookmark(true); };

        const btnFile = document.createElement('button');
        btnFile.textContent = '📁 重新绑定本地文件';
        btnFile.onclick = () => { menu.style.display = 'none'; selectMarkdownFile(); };

        menu.append(btnQuick, btnCustom, btnFile);
        container.appendChild(mainBtn);
        container.appendChild(menu);
        document.body.appendChild(container);

        let isOpen = false;
        mainBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            isOpen = !isOpen;
            menu.style.display = isOpen ? 'flex' : 'none';
        });

        document.addEventListener('click', () => {
            if (menu.style.display === 'flex') menu.style.display = 'none';
        });
    }

    refreshData();
    createUI();
})();