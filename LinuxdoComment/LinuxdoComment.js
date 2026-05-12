// ==UserScript==
// @name         LINUX DO 默认树形评论区1.4
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  在访问 LINUX DO 帖子时，默认使用树形评论区显示（自动将 /t/ 替换为 /n/，修复楼层尾缀导致白屏及滚动位置残留问题）
// @author       You
// @match        *://linux.do/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const SITE_TITLE = 'LINUX DO';
    const ALLOW_FLAT_TOPIC_KEY = 'linuxdo-comment-allow-flat-topic-id';
    let forceScrollTop = false; // 用于标记是否需要强制滚动到顶部
    let pendingTopicTitle = '';
    let pendingTopicId = '';
    let topicTitleRequest = null;
    let topicTitleRequestId = '';

    function normalizeTitleText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function stripSiteTitle(title) {
        return normalizeTitleText(title).replace(/\s+-\s+LINUX DO$/i, '');
    }

    function getTopicTitleFromLink(link) {
        let title = normalizeTitleText(link.getAttribute('title') || link.getAttribute('aria-label'));
        if (!title) title = normalizeTitleText(link.textContent);
        return stripSiteTitle(title);
    }

    function getTopicTitleFromPage() {
        let titleNode = document.querySelector('h1 .fancy-title, .topic-title h1, .title-wrapper h1, h1');
        if (titleNode) return stripSiteTitle(titleNode.textContent);

        let metaTitle = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
        return stripSiteTitle(metaTitle ? metaTitle.getAttribute('content') || metaTitle.content : '');
    }

    function getExpectedDocumentTitle(topicTitle) {
        let cleanTitle = stripSiteTitle(topicTitle);
        return cleanTitle ? `${cleanTitle} - ${SITE_TITLE}` : '';
    }

    function shouldRestoreDocumentTitle(topicTitle) {
        let currentTitle = normalizeTitleText(document.title);
        return !currentTitle || currentTitle === SITE_TITLE || !currentTitle.includes(topicTitle);
    }

    function getTopicIdFromPath(pathname) {
        let match = normalizeTitleText(pathname).match(/^\/[tn]\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
        return match ? match[1] : '';
    }

    function getTopicIdFromUrl(urlValue) {
        try {
            return getTopicIdFromPath(new URL(urlValue, window.location.origin).pathname);
        } catch (e) {
            return '';
        }
    }

    function getSessionStorage() {
        try {
            return window.sessionStorage;
        } catch (e) {
            return null;
        }
    }

    function rememberFlatViewBypass(topicId) {
        let storage = getSessionStorage();
        if (!storage || !topicId) return;
        storage.setItem(ALLOW_FLAT_TOPIC_KEY, topicId);
    }

    function consumeFlatViewBypass(topicId) {
        let storage = getSessionStorage();
        if (!storage || !topicId) return false;

        let storedTopicId = storage.getItem(ALLOW_FLAT_TOPIC_KEY);
        if (!storedTopicId) return false;

        storage.removeItem(ALLOW_FLAT_TOPIC_KEY);
        return storedTopicId === topicId;
    }

    function isFlatViewLink(link) {
        let label = normalizeTitleText([
            link.textContent,
            link.getAttribute('title'),
            link.getAttribute('aria-label'),
        ].filter(Boolean).join(' ')).toLowerCase();

        return label.includes('view as flat') ||
            label.includes('以平面图查看') ||
            label.includes('平面图查看') ||
            label.includes('平面视图') ||
            label.includes('平铺');
    }

    function fetchTopicTitleFromApi(topicId) {
        if (!topicId || typeof fetch !== 'function') return null;
        if (topicTitleRequest && topicTitleRequestId === topicId) return topicTitleRequest;

        topicTitleRequestId = topicId;
        topicTitleRequest = fetch(`/t/${topicId}.json`)
            .then((response) => {
                if (!response || !response.ok) return null;
                return response.json();
            })
            .then((data) => {
                let topicTitle = stripSiteTitle(data && data.title);
                if (!topicTitle || getTopicIdFromPath(window.location.pathname) !== topicId) return '';

                pendingTopicId = topicId;
                pendingTopicTitle = topicTitle;
                restoreTopicTitleIfNeeded();
                return topicTitle;
            })
            .catch((e) => {
                console.error('树形评论区脚本获取话题标题失败:', e);
                return '';
            });

        return topicTitleRequest;
    }

    function restoreTopicTitleIfNeeded() {
        if (!window.location.pathname.startsWith('/n/')) return false;

        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        let topicTitle = pendingTopicId === currentTopicId ? pendingTopicTitle : '';
        if (!topicTitle) topicTitle = getTopicTitleFromPage();
        if (topicTitle) {
            pendingTopicId = currentTopicId;
            pendingTopicTitle = topicTitle;
        } else {
            fetchTopicTitleFromApi(currentTopicId);
            return false;
        }

        if (!shouldRestoreDocumentTitle(topicTitle)) return false;

        let expectedTitle = getExpectedDocumentTitle(topicTitle);
        if (!expectedTitle) return false;

        document.title = expectedTitle;
        return true;
    }

    function scheduleTitleRestore() {
        [100, 500, 1500, 3000].forEach((delay) => {
            setTimeout(restoreTopicTitleIfNeeded, delay);
        });
    }

    // 核心转换逻辑：处理链接替换并剥离楼层号
    function getNestedUrl(originalUrl) {
        try {
            let isRelative = originalUrl.startsWith('/');
            let baseUrl = isRelative ? window.location.origin : '';
            let url = new URL(originalUrl, baseUrl || undefined);

            if (url.pathname.startsWith('/t/')) {
                let newPath = url.pathname;

                // 1. 匹配带 slug 的标准链接: /t/话题名/帖子ID/楼层号
                if (/^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(newPath)) {
                    newPath = newPath.replace(/^\/t\/([^/]+)\/(\d+)(?:\/\d+)?\/?$/, '/n/$1/$2');
                }
                // 2. 匹配无 slug 的短链接: /t/帖子ID/楼层号
                else if (/^\/t\/\d+(?:\/\d+)?\/?$/.test(newPath)) {
                    newPath = newPath.replace(/^\/t\/(\d+)(?:\/\d+)?\/?$/, '/n/$1');
                } else {
                    newPath = newPath.replace(/^\/t\//, '/n/');
                }

                url.pathname = newPath;
                if (!url.searchParams.has('sort')) url.searchParams.set('sort', 'old');
                return isRelative ? url.pathname + url.search + url.hash : url.href;
            }
        } catch (e) {
            console.error("树形评论区脚本 URL 解析出错:", e);
        }
        return originalUrl;
    }

    // 1. 处理页面初次加载或外部直接跳转
    if (window.location.pathname.startsWith('/t/')) {
        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        if (!consumeFlatViewBypass(currentTopicId)) {
            let targetUrl = getNestedUrl(window.location.href);
            if (targetUrl !== window.location.href) {
                window.location.replace(targetUrl);
            }
        }
    }

    // 2. 拦截单页应用(SPA)内的所有链接点击
    window.addEventListener('click', function (e) {
        let a = e.target.closest('a');
        if (!a) return;

        let href = a.getAttribute('href');
        if (!href) return;

        // 防死循环：允许用户主动点击切回平铺模式(View as flat / 以平面图查看)
        if (isFlatViewLink(a)) {
            rememberFlatViewBypass(getTopicIdFromUrl(href));
            return;
        }

        // 如果点击的是帖子链接
        if (href.startsWith('/t/') || href.startsWith('https://linux.do/t/')) {
            let newHref = getNestedUrl(href);
            if (newHref !== href) {
                a.setAttribute('href', newHref);
            }
            pendingTopicId = getTopicIdFromUrl(newHref);
            pendingTopicTitle = getTopicTitleFromLink(a);
            // 记录已点击，准备在页面渲染后滚动到顶部
            forceScrollTop = true;
            scheduleTitleRestore();
            // 设置一个兜底：5秒后自动取消标记，防止影响后续的普通操作
            setTimeout(() => { forceScrollTop = false; }, 5000);
        }
    }, true);

    // 3. 监听网页标题变化 (这是检测 SPA 单页应用是否渲染完成的最稳妥方式)
    window.addEventListener('DOMContentLoaded', () => {
        let titleEl = document.querySelector('title');
        if (!titleEl) return;

        let lastTitle = document.title;
        new MutationObserver(() => {
            if (document.title !== lastTitle) {
                lastTitle = document.title;
                // 如果刚刚点击了帖子，并且现在正处于树形视图页面
                if (forceScrollTop && window.location.pathname.startsWith('/n/')) {
                    // 瞬间回到顶部
                    window.scrollTo({ top: 0, behavior: 'instant' });
                    // 保险起见，稍微延迟再执行一次（应对网络加载卡顿导致的 DOM 渲染延迟）
                    setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 100);
                    forceScrollTop = false; // 执行完毕后重置状态
                }
                if (restoreTopicTitleIfNeeded()) {
                    lastTitle = document.title;
                }
            }
        }).observe(titleEl, { childList: true, characterData: true, subtree: true });

        scheduleTitleRestore();
    });
})();
