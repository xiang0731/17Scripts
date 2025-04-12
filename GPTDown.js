// ==UserScript==
// @name         ChatGPT对话转Markdown
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  将ChatGPT对话转换为Markdown格式，并提供复制和下载功能
// @author       Xiang
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 创建按钮样式
    const style = document.createElement('style');
    style.textContent = `
        .gpt-md-btn {
            position: fixed;
            right: 20px;
            z-index: 1000;
            background-color: #10a37f;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 14px;
            cursor: pointer;
            margin-top: 5px;
            transition: background-color 0.3s;
        }
        .gpt-md-btn:hover {
            background-color: #0d8a6c;
        }
        .copy-btn {
            top: 70px;
        }
        .download-btn {
            top: 110px;
        }
    `;
    document.head.appendChild(style);

    // 创建按钮
    function createButtons() {
        const copyButton = document.createElement('button');
        copyButton.textContent = '复制对话为Markdown';
        copyButton.className = 'gpt-md-btn copy-btn';
        copyButton.addEventListener('click', copyToClipboard);

        const downloadButton = document.createElement('button');
        downloadButton.textContent = '下载对话为Markdown';
        downloadButton.className = 'gpt-md-btn download-btn';
        downloadButton.addEventListener('click', downloadMarkdown);

        // 添加调试按钮
        const debugButton = document.createElement('button');
        debugButton.textContent = '调试信息';
        debugButton.className = 'gpt-md-btn debug-btn';
        debugButton.style.top = '150px';
        debugButton.addEventListener('click', debugStructure);

        document.body.appendChild(copyButton);
        document.body.appendChild(downloadButton);
        document.body.appendChild(debugButton);
    }

    // 提取对话内容并转换为Markdown
    function getConversationAsMarkdown() {
        // 尝试多种可能的选择器来找到对话容器
        let threadContainer = null;

        // 选择器列表，按优先级排序
        const selectors = [
            'main div[class*="react-scroll-to-bottom"]',
            'div[class*="chat-container"]',
            'div[class*="conversation-container"]',
            'main div[class*="overflow-y-auto"]',
            'div[role="presentation"] div[class*="overflow-y-auto"]',
            'div.flex.flex-col.text-sm',
            'main .flex-1.overflow-hidden',
            'div[class*="chat-pg-"]'
        ];

        // 尝试所有可能的选择器
        for (const selector of selectors) {
            const container = document.querySelector(selector);
            if (container) {
                threadContainer = container;
                console.log('找到对话容器，使用选择器:', selector);
                break;
            }
        }

        if (!threadContainer) {
            console.error('无法找到对话容器');
            alert('无法找到对话内容。请在控制台中提供当前页面HTML以帮助更新脚本。');
            return "无法找到对话内容";
        }

        const conversationTitle = document.title.replace(' - ChatGPT', '').trim();
        let markdown = `# ${conversationTitle}\n\n`;

        // 尝试多种选择器找对话块
        let messageNodes = threadContainer.querySelectorAll('div[data-message-author-role]');

        if (!messageNodes || messageNodes.length === 0) {
            messageNodes = threadContainer.querySelectorAll('div[data-testid*="conversation-turn-"]');
        }

        if (!messageNodes || messageNodes.length === 0) {
            messageNodes = threadContainer.querySelectorAll('.group.w-full');
        }

        if (!messageNodes || messageNodes.length === 0) {
            console.error('无法找到对话消息');
            alert('无法找到对话消息。尝试查看浏览器控制台获取更多信息。');
            return "无法找到对话消息";
        }

        console.log(`找到 ${messageNodes.length} 条消息`);

        messageNodes.forEach((node, index) => {
            // 尝试多种方式确定角色
            let isUser = false;

            if (node.hasAttribute('data-message-author-role')) {
                isUser = node.getAttribute('data-message-author-role') === 'user';
            } else if (node.querySelector('.flex.items-center.justify-center.p-1.rounded-md')) {
                // 用户通常有头像图标
                isUser = true;
            } else if (node.querySelector('img[alt*="User"]')) {
                isUser = true;
            } else {
                // 如果无法确定，根据索引奇偶判断（通常用户在奇数位）
                isUser = index % 2 === 0;
            }

            // 尝试多种选择器找到内容
            let content = node.querySelector('div[class*="prose"]');

            if (!content) {
                content = node.querySelector('.markdown');
            }

            if (!content) {
                content = node.querySelector('.text-message');
            }

            if (!content) {
                // 找不到特定内容容器，使用整个节点
                content = node;
            }

            if (!content) return;

            // 添加角色标题
            markdown += `## ${isUser ? '用户' : 'ChatGPT'}\n\n`;

            // 获取HTML内容并进行处理
            const htmlContent = content.innerHTML;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;

            // 处理代码块
            const codeBlocks = tempDiv.querySelectorAll('pre');
            codeBlocks.forEach(codeBlock => {
                const language = codeBlock.querySelector('code')?.className.replace('language-', '') || '';
                const codeContent = codeBlock.textContent.trim();
                const markdownCodeBlock = `\`\`\`${language}\n${codeContent}\n\`\`\``;
                codeBlock.outerHTML = markdownCodeBlock;
            });

            // 处理内联代码
            const inlineCodeBlocks = tempDiv.querySelectorAll('code:not(pre code)');
            inlineCodeBlocks.forEach(inlineCode => {
                inlineCode.outerHTML = `\`${inlineCode.textContent}\``;
            });

            // 处理链接
            const links = tempDiv.querySelectorAll('a');
            links.forEach(link => {
                link.outerHTML = `[${link.textContent}](${link.href})`;
            });

            // 处理粗体
            const bold = tempDiv.querySelectorAll('strong');
            bold.forEach(b => {
                b.outerHTML = `**${b.textContent}**`;
            });

            // 处理斜体
            const italic = tempDiv.querySelectorAll('em');
            italic.forEach(i => {
                i.outerHTML = `*${i.textContent}*`;
            });

            // 处理列表
            const lists = tempDiv.querySelectorAll('ol, ul');
            lists.forEach(list => {
                const items = list.querySelectorAll('li');
                let listContent = '';
                items.forEach((item, index) => {
                    const prefix = list.tagName === 'OL' ? `${index + 1}. ` : '- ';
                    listContent += `${prefix}${item.textContent}\n`;
                });
                list.outerHTML = `\n${listContent}\n`;
            });

            markdown += tempDiv.textContent.trim() + '\n\n';
        });

        // 添加生成时间脚注
        const date = new Date().toLocaleString();
        markdown += `---\n*保存时间: ${date}*`;

        return markdown;
    }

    // 复制到剪贴板
    function copyToClipboard() {
        const markdown = getConversationAsMarkdown();
        navigator.clipboard.writeText(markdown)
            .then(() => {
                alert('对话已复制到剪贴板');
            })
            .catch(err => {
                console.error('复制失败:', err);
                alert('复制失败，请查看控制台获取详细信息');
            });
    }

    // 下载Markdown文件
    function downloadMarkdown() {
        const markdown = getConversationAsMarkdown();
        const conversationTitle = document.title.replace(' - ChatGPT', '').trim() || 'ChatGPT对话';
        const fileName = `${conversationTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;

        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();

        // 清理
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    // 调试当前页面结构
    function debugStructure() {
        console.log('===== ChatGPT页面结构调试 =====');

        // 尝试识别可能的对话容器
        for (const selector of [
            'main div[class*="react-scroll-to-bottom"]',
            'div[class*="chat-container"]',
            'div[class*="conversation-container"]',
            'main div[class*="overflow-y-auto"]',
            'div[role="presentation"] div[class*="overflow-y-auto"]',
            'div.flex.flex-col.text-sm',
            'main .flex-1.overflow-hidden',
            'div[class*="chat-pg-"]',
            // 添加更多可能的选择器
            'main',
            'div[role="main"]',
            '.overflow-y-auto',
            '.flex-1'
        ]) {
            const elements = document.querySelectorAll(selector);
            console.log(`选择器 "${selector}": 找到 ${elements.length} 个元素`);

            if (elements.length > 0) {
                console.log('第一个元素:', elements[0]);
            }
        }

        // 尝试识别消息块
        console.log('===== 可能的消息块 =====');
        for (const selector of [
            'div[data-message-author-role]',
            'div[data-testid*="conversation-turn-"]',
            '.group.w-full',
            'div[class*="message"]',
            'div[class*="chat-message"]'
        ]) {
            const elements = document.querySelectorAll(selector);
            console.log(`选择器 "${selector}": 找到 ${elements.length} 个元素`);

            if (elements.length > 0) {
                console.log('第一个元素:', elements[0]);
            }
        }

        alert('调试信息已输出到控制台。请按F12打开开发者工具查看。');
    }

    // 页面加载完成后创建按钮
    window.addEventListener('load', () => {
        // 给ChatGPT页面一些时间加载
        setTimeout(createButtons, 2000);
    });

    // 监听页面变化，确保在导航到新对话时按钮仍然存在
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                if (!document.querySelector('.gpt-md-btn')) {
                    createButtons();
                    break;
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();