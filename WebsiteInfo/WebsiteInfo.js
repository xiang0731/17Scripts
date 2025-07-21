// ==UserScript==
// @name         WebsiteInfo
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  获取当前网站的详细信息，并提供便捷的复制功能
// @author       Xiang0731
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 创建样式
    const styles = `
            #website-info-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 340px;
                height: auto;
                min-height: auto;
                max-height: none;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(10px);
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                color: white;
                font-family: 'Arial', sans-serif;
                z-index: 10000;
                overflow: hidden;
                transition: all 0.3s ease;
                border: 1px solid rgba(255, 255, 255, 0.2);
                font-size: 12px;
                cursor: move;
                box-sizing: border-box;
            }

            #website-info-panel.minimized {
                height: 35px !important;
                overflow: hidden;
            }

            .panel-header {
                background: rgba(0, 0, 0, 0.3);
                padding: 8px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.15);
                cursor: move;
                box-sizing: border-box;
            }

            .panel-title {
                font-size: 13px;
                font-weight: bold;
                margin: 0;
                opacity: 0.9;
            }

            .toggle-btn {
                background: none;
                border: none;
                color: white;
                font-size: 14px;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 3px;
                transition: background 0.2s ease;
                opacity: 0.8;
                flex-shrink: 0;
            }

            .toggle-btn:hover {
                background: rgba(255, 255, 255, 0.2);
                opacity: 1;
            }

            .panel-content {
                padding: 8px;
                overflow: hidden;
                box-sizing: border-box;
            }

            .info-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
                table-layout: fixed;
            }

            .info-table tr {
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                transition: background 0.2s ease;
            }

            .info-table tr:hover {
                background: rgba(255, 255, 255, 0.05);
            }

            .info-table td {
                padding: 6px 2px;
                vertical-align: top;
                border: none;
                box-sizing: border-box;
                overflow: hidden;
            }

            .info-label {
                font-weight: bold;
                color: #e0e0e0;
                width: 70px;
                min-width: 70px;
                max-width: 70px;
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                opacity: 0.9;
                word-wrap: break-word;
                overflow: hidden;
                text-overflow: ellipsis;
                padding-right: 4px;
            }

            .info-value {
                word-wrap: break-word;
                word-break: break-all;
                line-height: 1.3;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 11px;
                color: #f5f5f5;
                padding: 6px 4px;
            }

            .info-value.expandable {
                cursor: pointer;
                position: relative;
            }

            .info-value.expanded {
                white-space: normal;
                max-height: none;
            }

            .favicon-container {
                display: flex;
                align-items: center;
                gap: 4px;
                max-width: 100%;
                overflow: hidden;
            }

            .favicon {
                width: 16px;
                height: 16px;
                border-radius: 2px;
                flex-shrink: 0;
            }

            .favicon-url {
                font-size: 9px;
                opacity: 0.7;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .action-cell {
                width: 90px;
                min-width: 90px;
                max-width: 90px;
                padding: 6px 8px 6px 2px !important;
                text-align: right;
            }

            .action-buttons {
                display: flex;
                gap: 3px;
                justify-content: flex-end;
                align-items: center;
                width: 100%;
            }

            .copy-btn, .download-btn {
                background: rgba(40, 167, 69, 0.8);
                border: none;
                color: white;
                padding: 4px 8px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 9px;
                font-weight: bold;
                transition: all 0.2s ease;
                text-transform: uppercase;
                letter-spacing: 0.2px;
                min-width: 38px;
                opacity: 0.8;
                text-align: center;
                white-space: nowrap;
                flex-shrink: 0;
            }

            .download-btn {
                background: rgba(0, 123, 255, 0.8);
            }

            .copy-btn:hover {
                background: rgba(40, 167, 69, 1);
                opacity: 1;
                transform: scale(1.02);
            }

            .download-btn:hover {
                background: rgba(0, 123, 255, 1);
                opacity: 1;
                transform: scale(1.02);
            }

            .copy-btn.copied {
                background: rgba(255, 193, 7, 0.9);
                animation: pulse 0.4s ease;
            }

            .download-btn.downloading {
                background: rgba(255, 193, 7, 0.9);
                animation: pulse 0.4s ease;
            }

            /* 展开/收起按钮样式 */
            .expand-btn {
                background: rgba(108, 117, 125, 0.8);
                border: none;
                color: white;
                padding: 6px 8px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 10px;
                font-weight: bold;
                transition: all 0.3s ease;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                width: 100%;
                box-sizing: border-box;
                text-align: center;
            }

            .expand-btn:hover {
                background: rgba(108, 117, 125, 1);
                transform: scale(1.02);
            }

            .expand-btn.expanded {
                background: rgba(220, 53, 69, 0.8);
            }

            .expand-btn.expanded:hover {
                background: rgba(220, 53, 69, 1);
            }

            /* 详细信息行的样式 */
            .detail-row {
                display: none;
                opacity: 0;
                transform: translateY(-10px);
                transition: all 0.3s ease;
            }

            .detail-row.show {
                display: table-row;
                opacity: 1;
                transform: translateY(0);
            }

            .expand-toggle-row {
                border-bottom: 2px solid rgba(255, 255, 255, 0.2) !important;
            }

            .expand-toggle-row td {
                padding: 10px 2px !important;
            }

            .expand-toggle-row .expand-btn-cell {
                padding: 10px 8px 10px 2px !important;
            }

            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }

            /* 拖拽时的样式 */
            #website-info-panel.dragging {
                opacity: 0.8;
                transform: rotate(2deg);
            }

            /* 让面板在移动设备上更小 */
            @media (max-width: 768px) {
                #website-info-panel {
                    width: 320px;
                    font-size: 11px;
                }
                
                .info-label {
                    width: 65px;
                    min-width: 65px;
                    max-width: 65px;
                    font-size: 9px;
                }
                
                .action-cell {
                    width: 80px;
                    min-width: 80px;
                    max-width: 80px;
                    padding: 6px 6px 6px 2px !important;
                }

                .copy-btn, .download-btn {
                    min-width: 34px;
                    font-size: 8px;
                    padding: 3px 6px;
                }

                .action-buttons {
                    gap: 2px;
                }
            }
        `;

    // 创建样式标签
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    // 拖拽功能变量
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    // 获取网站信息的函数
    function getWebsiteInfo() {
        const info = {};

        // 网站地址
        info.url = window.location.href;

        // 网站标题
        info.title = document.title || '无标题';

        // 网站描述
        const descriptionMeta = document.querySelector('meta[name="description"]') ||
            document.querySelector('meta[property="og:description"]');
        info.description = descriptionMeta ? descriptionMeta.content : '无描述';

        // 关键词
        const keywordsMeta = document.querySelector('meta[name="keywords"]');
        info.keywords = keywordsMeta ? keywordsMeta.content : '无关键词';

        // 作者
        const authorMeta = document.querySelector('meta[name="author"]');
        info.author = authorMeta ? authorMeta.content : '未知';

        // Favicon
        let faviconUrl = '';
        const faviconLink = document.querySelector('link[rel="icon"]') ||
            document.querySelector('link[rel="shortcut icon"]') ||
            document.querySelector('link[rel="apple-touch-icon"]');

        if (faviconLink) {
            faviconUrl = faviconLink.href;
        } else {
            // 尝试默认favicon路径
            faviconUrl = new URL('/favicon.ico', window.location.origin).href;
        }
        info.favicon = faviconUrl;

        // 域名
        info.domain = window.location.hostname;

        // 协议
        info.protocol = window.location.protocol;

        // 端口
        info.port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

        // 路径
        info.pathname = window.location.pathname;

        // 查询参数
        info.search = window.location.search;

        // 网站编码
        const charsetMeta = document.querySelector('meta[charset]') ||
            document.querySelector('meta[http-equiv="Content-Type"]');
        info.charset = charsetMeta ? (charsetMeta.charset || charsetMeta.content) : document.characterSet || '未知';

        // 网站语言
        info.language = document.documentElement.lang || document.querySelector('meta[http-equiv="content-language"]')?.content || '未知';

        return info;
    }

    // 复制到剪贴板的函数
    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = '已复制';
            button.classList.add('copied');

            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 1200);
        }).catch(err => {
            console.error('复制失败:', err);
            // 降级方案
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);

            const originalText = button.textContent;
            button.textContent = '已复制';
            button.classList.add('copied');

            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 1200);
        });
    }

    // 下载图标的函数
    function downloadFavicon(url, button) {
        if (!url || url === '无图标') {
            alert('无可下载的图标');
            return;
        }

        button.textContent = '下载中';
        button.classList.add('downloading');

        // 获取图标
        fetch(url)
            .then(response => {
                if (!response.ok) throw new Error('下载失败');
                return response.blob();
            })
            .then(blob => {
                // 创建下载链接
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);

                // 确定文件扩展名
                const urlObj = new URL(url);
                let filename = urlObj.pathname.split('/').pop() || 'favicon';
                if (!filename.includes('.')) {
                    // 根据 MIME 类型确定扩展名
                    const mimeType = blob.type;
                    if (mimeType.includes('png')) filename += '.png';
                    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) filename += '.jpg';
                    else if (mimeType.includes('gif')) filename += '.gif';
                    else if (mimeType.includes('svg')) filename += '.svg';
                    else if (mimeType.includes('webp')) filename += '.webp';
                    else filename += '.ico';
                }

                link.download = `${window.location.hostname}-${filename}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);

                button.textContent = '已下载';
                setTimeout(() => {
                    button.textContent = '下载';
                    button.classList.remove('downloading');
                }, 1200);
            })
            .catch(err => {
                console.error('下载失败:', err);

                // 降级方案：打开新窗口
                window.open(url, '_blank');

                button.textContent = '已打开';
                setTimeout(() => {
                    button.textContent = '下载';
                    button.classList.remove('downloading');
                }, 1200);
            });
    }

    // 创建表格行的函数
    function createTableRow(label, value, copyValue = null, isDetail = false) {
        const row = document.createElement('tr');
        if (isDetail) {
            row.className = 'detail-row';
        }

        const labelCell = document.createElement('td');
        labelCell.className = 'info-label';
        labelCell.textContent = label;

        const valueCell = document.createElement('td');
        valueCell.className = 'info-value';

        if (label === '图标' && value) {
            const container = document.createElement('div');
            container.className = 'favicon-container';

            const img = document.createElement('img');
            img.src = value;
            img.className = 'favicon';
            img.onerror = () => {
                img.style.display = 'none';
                const text = document.createElement('span');
                text.textContent = '无图标';
                text.style.fontSize = '9px';
                container.appendChild(text);
            };

            const urlText = document.createElement('div');
            urlText.className = 'favicon-url';
            urlText.textContent = value;
            urlText.title = value;

            container.appendChild(img);
            container.appendChild(urlText);
            valueCell.appendChild(container);
        } else {
            const displayValue = value || '未获取到信息';
            valueCell.textContent = displayValue;
            valueCell.title = displayValue; // 添加tooltip显示完整内容

            // 如果内容较长，添加点击展开功能
            if (displayValue.length > 35) {
                valueCell.classList.add('expandable');
                valueCell.onclick = () => {
                    valueCell.classList.toggle('expanded');
                };
            }
        }

        const actionCell = document.createElement('td');
        actionCell.className = 'action-cell';
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'action-buttons';

        // 复制按钮
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '复制';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(copyValue || value, copyBtn);
        };
        buttonContainer.appendChild(copyBtn);

        // 如果是图标行，添加下载按钮
        if (label === '图标' && value) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-btn';
            downloadBtn.textContent = '下载';
            downloadBtn.onclick = (e) => {
                e.stopPropagation();
                downloadFavicon(value, downloadBtn);
            };
            buttonContainer.appendChild(downloadBtn);
        }

        actionCell.appendChild(buttonContainer);

        row.appendChild(labelCell);
        row.appendChild(valueCell);
        row.appendChild(actionCell);

        return row;
    }

    // 创建展开/收起按钮行
    function createExpandToggleRow() {
        const row = document.createElement('tr');
        row.className = 'expand-toggle-row';

        const emptyCell1 = document.createElement('td');
        const buttonCell = document.createElement('td');
        buttonCell.className = 'expand-btn-cell';
        buttonCell.setAttribute('colspan', '2');

        const expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.textContent = '显示详细信息';

        let isExpanded = false;
        expandBtn.onclick = () => {
            isExpanded = !isExpanded;
            const detailRows = document.querySelectorAll('.detail-row');

            if (isExpanded) {
                expandBtn.textContent = '隐藏详细信息';
                expandBtn.classList.add('expanded');
                // 使用setTimeout来确保动画效果
                setTimeout(() => {
                    detailRows.forEach(row => row.classList.add('show'));
                }, 10);
            } else {
                expandBtn.textContent = '显示详细信息';
                expandBtn.classList.remove('expanded');
                detailRows.forEach(row => row.classList.remove('show'));
            }
        };

        buttonCell.appendChild(expandBtn);
        row.appendChild(emptyCell1);
        row.appendChild(buttonCell);

        return row;
    }

    // 添加拖拽功能
    function addDragFunctionality(panel) {
        const header = panel.querySelector('.panel-header');

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            panel.classList.add('dragging');
            const rect = panel.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;

            // 阻止文本选择
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const x = e.clientX - dragOffset.x;
            const y = e.clientY - dragOffset.y;

            // 限制面板在视窗内
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;

            panel.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
            panel.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            panel.style.right = 'auto'; // 移除右侧定位
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                panel.classList.remove('dragging');
            }
        });
    }

    // 创建面板
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'website-info-panel';

        // 创建头部
        const header = document.createElement('div');
        header.className = 'panel-header';

        const title = document.createElement('h3');
        title.className = 'panel-title';
        title.textContent = '网站信息';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-btn';
        toggleBtn.textContent = '−';
        toggleBtn.onclick = (e) => {
            e.stopPropagation(); // 阻止拖拽
            panel.classList.toggle('minimized');
            toggleBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
        };

        header.appendChild(title);
        header.appendChild(toggleBtn);

        // 创建内容区域
        const content = document.createElement('div');
        content.className = 'panel-content';

        // 创建表格
        const table = document.createElement('table');
        table.className = 'info-table';

        // 获取网站信息
        const info = getWebsiteInfo();

        // 基本信息（默认显示）
        const basicItems = [
            ['标题', info.title],
            ['地址', info.url],
            ['域名', info.domain],
            ['图标', info.favicon],
            ['路径', info.pathname]
        ];

        // 详细信息（需要展开显示）
        const detailItems = [
            ['协议', info.protocol],
            ['端口', info.port],
            ['参数', info.search || '无'],
            ['描述', info.description],
            ['关键词', info.keywords],
            ['作者', info.author],
            ['编码', info.charset],
            ['语言', info.language]
        ];

        // 添加基本信息行
        basicItems.forEach(([label, value]) => {
            const row = createTableRow(label, value);
            table.appendChild(row);
        });

        // 添加展开/收起按钮行
        const expandToggleRow = createExpandToggleRow();
        table.appendChild(expandToggleRow);

        // 添加详细信息行（默认隐藏）
        detailItems.forEach(([label, value]) => {
            const row = createTableRow(label, value, null, true);
            table.appendChild(row);
        });

        content.appendChild(table);
        panel.appendChild(header);
        panel.appendChild(content);

        // 添加拖拽功能
        addDragFunctionality(panel);

        return panel;
    }

    // 等待页面加载完成后创建面板
    function initPanel() {
        // 检查是否已经存在面板
        if (document.getElementById('website-info-panel')) {
            return;
        }

        const panel = createPanel();
        document.body.appendChild(panel);
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPanel);
    } else {
        initPanel();
    }

    // 监听页面变化（SPA应用）
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            // 移除旧面板
            const oldPanel = document.getElementById('website-info-panel');
            if (oldPanel) {
                oldPanel.remove();
            }
            // 延迟创建新面板，等待页面更新
            setTimeout(initPanel, 1000);
        }
    }).observe(document, { subtree: true, childList: true });

})(); 