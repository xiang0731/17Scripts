// ==UserScript==
// @name         LINUX DO 默认树形评论区
// @namespace    https://greasyfork.org/users/1407672
// @version      1.7.0
// @description  在访问 LINUX DO 帖子时，默认使用树形评论区显示，并在话题页提供全回复话题内搜索
// @author       xiang0731
// @match        *://linux.do/*
// @match        *://idcflare.com/*
// @grant        none
// @run-at       document-start
// @license      MIT
// @downloadURL  https://update.greasyfork.org/scripts/578969/%E9%BB%98%E8%AE%A4%E6%A0%91%E5%BD%A2%E8%AF%84%E8%AE%BA%E5%8C%BA.user.js
// @updateURL    https://update.greasyfork.org/scripts/578969/%E9%BB%98%E8%AE%A4%E6%A0%91%E5%BD%A2%E8%AF%84%E8%AE%BA%E5%8C%BA.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const SITE_TITLE = 'LINUX DO';
    const ALLOW_FLAT_TOPIC_KEY = 'linuxdo-comment-allow-flat-topic-id';
    const ALLOW_NESTED_FLOOR_TOPIC_KEY = 'linuxdo-comment-allow-nested-floor-topic-id';
    const TOPIC_TITLE_BY_ID_KEY = 'linuxdo-comment-topic-title-by-id';
    const TOPIC_SEARCH_TARGET_KEY = 'linuxdo-comment-topic-search-target';
    const TOPIC_SEARCH_BUTTON_ID = 'linuxdo-topic-search-entry';
    const TOPIC_SEARCH_MENU_ID = 'linuxdo-topic-search-menu';
    const TOPIC_SEARCH_PANEL_ID = 'linuxdo-topic-search-panel';
    const TOPIC_SEARCH_STYLE_ID = 'linuxdo-topic-search-style';
    const FLAT_VIEW_URL_PARAM = 'linuxdo_flat';
    const PRIVATE_MESSAGE_ARCHETYPE = 'private_message';
    const BANNER_ARCHETYPE = 'banner';
    const POST_VOTING_SUBTYPE = 'question_answer';
    const NESTED_REWRITE_PRECHECKED_KEY = 'linuxdoNestedRewritePrechecked';
    const FLAT_VIEW_BYPASS_TTL_MS = 30 * 60 * 1000;
    let forceScrollTop = false; // 用于标记是否需要强制滚动到顶部
    let pendingTopicTitle = '';
    let pendingTopicId = '';
    let topicDataRequests = {};
    let topicTitleRequest = null;
    let topicTitleRequestId = '';
    let topicSearchAbortController = null;
    let topicSearchRefreshTimer = null;
    let topicSearchObserver = null;
    let topicSearchNavigationHooksInstalled = false;
    let handledTopicSearchTargetKey = '';

    function normalizeTitleText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function stripSiteTitle(title) {
        return normalizeTitleText(title).replace(/\s+-\s+LINUX DO$/i, '');
    }

    function isPrivateMessageTopicData(data) {
        return normalizeTitleText(data && data.archetype) === PRIVATE_MESSAGE_ARCHETYPE;
    }

    function hasTruthyTopicDataValue(value) {
        if (value === true) return true;
        if (typeof value === 'string') return normalizeTitleText(value).toLowerCase() === 'true';
        if (Array.isArray(value)) return value.length > 0;
        return !!(value && typeof value === 'object' && Object.keys(value).length > 0);
    }

    function postContainsPollData(post) {
        if (!post || typeof post !== 'object') return false;
        if (hasTruthyTopicDataValue(post.polls) || hasTruthyTopicDataValue(post.polls_votes)) return true;

        let customFields = post.custom_fields || {};
        return hasTruthyTopicDataValue(customFields.polls) ||
            hasTruthyTopicDataValue(customFields.has_polls) ||
            hasTruthyTopicDataValue(customFields.poll_enabled);
    }

    function isPollTopicData(data) {
        let posts = data && data.post_stream && Array.isArray(data.post_stream.posts) ?
            data.post_stream.posts :
            [];
        return posts.some(postContainsPollData);
    }

    function isPostVotingTopicData(data) {
        return !!(
            data &&
            (
                hasTruthyTopicDataValue(data.is_post_voting) ||
                normalizeTitleText(data.subtype) === POST_VOTING_SUBTYPE
            )
        );
    }

    function isUnsupportedNestedTopicData(data) {
        let archetype = normalizeTitleText(data && data.archetype);
        return archetype === PRIVATE_MESSAGE_ARCHETYPE ||
            archetype === BANNER_ARCHETYPE ||
            isPostVotingTopicData(data) ||
            isPollTopicData(data);
    }

    function isPrivateMessageTopicPage() {
        return !!(
            document.body &&
            document.body.classList &&
            document.body.classList.contains('archetype-private_message')
        );
    }

    function bodyHasAnyClass(classNames) {
        return !!(
            document.body &&
            document.body.classList &&
            classNames.some((className) => document.body.classList.contains(className))
        );
    }

    function isUnsupportedNestedTopicPage() {
        return bodyHasAnyClass([
            'archetype-private_message',
            'archetype-banner',
            'post-voting-topic',
            'topic-post-voting',
            'is-post-voting',
            'has-poll',
        ]);
    }

    function isPrivateMessageListPath(pathname) {
        return /^\/u\/[^/]+\/messages(?:\/|$)/.test(normalizeTitleText(pathname));
    }

    function isUnsupportedNestedLinkContext(link) {
        return !!(
            link &&
            typeof link.closest === 'function' &&
            link.closest([
                '.archetype-private_message',
                '[data-archetype="private_message"]',
                '[data-topic-archetype="private_message"]',
                '.archetype-banner',
                '[data-archetype="banner"]',
                '[data-topic-archetype="banner"]',
                '.post-voting-topic',
                '.topic-post-voting',
                '.is-post-voting',
                '[data-is-post-voting="true"]',
                '[data-topic-is-post-voting="true"]',
                '[data-subtype="question_answer"]',
                '[data-topic-subtype="question_answer"]',
                '.poll',
                '[data-poll-name]',
            ].join(', '))
        );
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

    function getRememberedTopicTitles() {
        let storage = getSessionStorage();
        if (!storage) return {};

        try {
            let value = JSON.parse(storage.getItem(TOPIC_TITLE_BY_ID_KEY) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (e) {
            storage.removeItem(TOPIC_TITLE_BY_ID_KEY);
            return {};
        }
    }

    function rememberTopicTitle(topicId, topicTitle) {
        let storage = getSessionStorage();
        let cleanTopicId = normalizeTitleText(topicId);
        let cleanTitle = stripSiteTitle(topicTitle);
        if (!storage || !cleanTopicId || !cleanTitle) return;

        let titles = getRememberedTopicTitles();
        titles[cleanTopicId] = cleanTitle;
        storage.setItem(TOPIC_TITLE_BY_ID_KEY, JSON.stringify(titles));
    }

    function getRememberedTopicTitle(topicId) {
        return stripSiteTitle(getRememberedTopicTitles()[normalizeTitleText(topicId)]);
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

    function getTopicSlugFromPath(pathname) {
        let match = normalizeTitleText(pathname).match(/^\/[tn]\/([^/]+)\/\d+(?:\/|$)/);
        return match && !/^\d+$/.test(match[1]) ? match[1] : '';
    }

    function getTopicIdFromUrl(urlValue) {
        try {
            return getTopicIdFromPath(new URL(urlValue, window.location.origin).pathname);
        } catch (e) {
            return '';
        }
    }

    function isKnownTopicUrl(urlValue) {
        try {
            let url = new URL(urlValue, window.location.origin);
            return url.pathname.startsWith('/t/') && (
                url.hostname === window.location.hostname ||
                url.hostname === 'linux.do' ||
                url.hostname === 'idcflare.com'
            );
        } catch (e) {
            return false;
        }
    }

    function getElementAttributeValue(element, name) {
        if (!element || typeof element.getAttribute !== 'function') return '';
        return normalizeTitleText(element.getAttribute(name));
    }

    function getElementDataValue(element, datasetNames, attributeNames) {
        if (!element) return '';

        for (let name of datasetNames) {
            let value = element.dataset && element.dataset[name];
            if (normalizeTitleText(value)) return normalizeTitleText(value);
        }

        for (let name of attributeNames) {
            let value = getElementAttributeValue(element, name);
            if (value) return value;
        }

        return '';
    }

    function buildTopicHrefFromElementData(element) {
        let topicId = getElementDataValue(element, ['topicId', 'topic_id', 'linuxdoTopicId'], [
            'data-topic-id',
            'data-topic_id',
            'data-linuxdo-topic-id',
        ]);
        if (!topicId) return '';

        let topicSlug = getElementDataValue(element, ['topicSlug', 'slug', 'topic_slug'], [
            'data-topic-slug',
            'data-slug',
            'data-topic_slug',
        ]);
        let postNumber = getElementDataValue(element, ['postNumber', 'post_number', 'linuxdoPostNumber'], [
            'data-post-number',
            'data-post_number',
            'data-linuxdo-post-number',
        ]);
        let basePath = topicSlug ? `/t/${topicSlug}/${topicId}` : `/t/${topicId}`;
        return postNumber ? `${basePath}/${postNumber}` : basePath;
    }

    function getElementNavigationHrefCandidates(element) {
        if (!element) return [];

        let candidates = [
            { href: getElementAttributeValue(element, 'href'), source: 'href' },
            { href: getElementAttributeValue(element, 'data-url'), source: 'data-url' },
            { href: getElementAttributeValue(element, 'data-href'), source: 'data-href' },
            { href: getElementAttributeValue(element, 'data-topic-url'), source: 'data-topic-url' },
            { href: getElementDataValue(element, ['url'], []), source: 'dataset-url' },
            { href: getElementDataValue(element, ['href'], []), source: 'dataset-href' },
            { href: getElementDataValue(element, ['topicUrl', 'topic_url'], []), source: 'dataset-topic-url' },
        ];

        let dataHref = buildTopicHrefFromElementData(element);
        if (dataHref) candidates.push({ href: dataHref, source: 'topic-data' });

        return candidates.filter((candidate) => candidate.href);
    }

    function getElementNavigationHref(element) {
        let candidates = getElementNavigationHrefCandidates(element);
        let topicCandidate = candidates.find((candidate) => isTopicLinkHref(candidate.href));
        return topicCandidate ? topicCandidate.href : (candidates[0] ? candidates[0].href : '');
    }

    function getTopicNavigationTarget(element) {
        let candidates = getElementNavigationHrefCandidates(element);
        return candidates.find((candidate) => isTopicLinkHref(candidate.href)) || null;
    }

    function isUserNotificationOrActivityPath(pathname) {
        return /^\/(?:u\/[^/]+|my)\/(?:notifications|activity)(?:\/|$)/.test(normalizeTitleText(pathname));
    }

    function isTopicListContext(element) {
        return !!(
            element &&
            typeof element.closest === 'function' &&
            element.closest([
                '.topic-list',
                '.topic-list-item',
                '.topic-list-body',
                '.latest-topic-list',
                '.latest-topic-list-item',
            ].join(', '))
        );
    }

    function findTopicNavigationElement(target) {
        if (!target || typeof target.closest !== 'function') return null;

        let link = target.closest('a');
        if (link) return link;

        let routedElement = target.closest('[data-url], [data-href], [data-topic-url]');
        if (routedElement) return routedElement;

        if (isUserNotificationOrActivityPath(window.location.pathname)) {
            return target.closest('[data-topic-id], [data-linuxdo-topic-id]');
        }

        let topicDataElement = target.closest('[data-topic-id], [data-linuxdo-topic-id]');
        if (isTopicListContext(topicDataElement)) return topicDataElement;

        return null;
    }

    function shouldSkipNestedRewriteForUnsupportedTopic(linkOrHref) {
        let href = typeof linkOrHref === 'string' ?
            linkOrHref :
            linkOrHref && typeof linkOrHref.getAttribute === 'function' ? linkOrHref.getAttribute('href') : '';

        if (isPrivateMessageListPath(window.location.pathname)) return true;
        if (isUnsupportedNestedLinkContext(typeof linkOrHref === 'string' ? null : linkOrHref)) return true;
        if (!isUnsupportedNestedTopicPage()) return false;

        let linkTopicId = getTopicIdFromUrl(href);
        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        return !!(linkTopicId && currentTopicId && linkTopicId === currentTopicId);
    }

    function shouldSkipNestedRewriteForPrivateMessage(linkOrHref) {
        return shouldSkipNestedRewriteForUnsupportedTopic(linkOrHref);
    }

    function shouldKeepCanonicalTopicLink(event, link) {
        let target = normalizeTitleText(link && typeof link.getAttribute === 'function' ? link.getAttribute('target') : '').toLowerCase();
        return !!(
            target === '_blank' ||
            (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1))
        );
    }

    function shouldShowTopicSearchButton(pathname) {
        let cleanPathname = normalizeTitleText(pathname);
        return (
            cleanPathname.startsWith('/n/') ||
            cleanPathname.startsWith('/t/')
        ) && !!getTopicIdFromPath(cleanPathname);
    }

    function decodeBasicHtmlEntities(text) {
        return String(text || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&#(\d+);/g, (match, code) => {
                let value = Number(code);
                return Number.isFinite(value) ? String.fromCharCode(value) : match;
            });
    }

    function stripHtmlToText(html) {
        return normalizeTitleText(decodeBasicHtmlEntities(String(html || '').replace(/<[^>]*>/g, ' ')));
    }

    function buildTopicSearchQuery(topicId, keyword) {
        let cleanTopicId = normalizeTitleText(topicId);
        let cleanKeyword = normalizeTitleText(keyword);
        if (!cleanTopicId || !cleanKeyword) return '';
        return `topic:${cleanTopicId} ${cleanKeyword}`;
    }

    function buildTopicSearchEndpoint(topicId, keyword) {
        let query = buildTopicSearchQuery(topicId, keyword);
        return query ? `/search/query.json?term=${encodeURIComponent(query)}&include_blurbs=true` : '';
    }

    function getTopicSearchFlatUrl(result, topicSlug) {
        let topicId = result && (result.topicId || result.topic_id);
        let postNumber = result && (result.postNumber || result.post_number);
        let slug = normalizeTitleText(topicSlug || (result && (result.topicSlug || result.topic_slug)));
        if (topicId && postNumber && slug) return `/t/${slug}/${topicId}/${postNumber}`;
        return topicId && postNumber ? `/t/${topicId}/${postNumber}` : '';
    }

    function getTopicSearchNestedUrl(result, topicSlug) {
        let topicId = result && (result.topicId || result.topic_id);
        let postNumber = result && (result.postNumber || result.post_number);
        let slug = normalizeTitleText(topicSlug || (result && (result.topicSlug || result.topic_slug)));
        if (topicId && postNumber && slug) return `/n/${slug}/${topicId}/${postNumber}`;
        return topicId && postNumber ? `/n/${topicId}/${postNumber}` : '';
    }

    function getTopicSearchTargetSelectors(target) {
        let postId = normalizeTitleText(target && (target.postId || target.id || target.post_id));
        let postNumber = normalizeTitleText(target && (target.postNumber || target.post_number));
        let selectors = [];
        if (postId) {
            selectors.push(`#post_${postId}`);
            selectors.push(`#post-${postId}`);
            selectors.push(`[data-post-id="${postId}"]`);
        }
        if (postNumber) selectors.push(`[data-post-number="${postNumber}"]`);
        if (postId) selectors.push(`article[data-post-id="${postId}"]`);
        if (postNumber) selectors.push(`article[data-post-number="${postNumber}"]`);
        return selectors;
    }

    function getTopicSearchTargetKey(target) {
        if (!target) return '';
        return [
            normalizeTitleText(target.topicId || target.topic_id),
            normalizeTitleText(target.postId || target.id || target.post_id),
            normalizeTitleText(target.postNumber || target.post_number),
        ].join(':');
    }

    function normalizeTopicSearchResults(data) {
        let posts = data && Array.isArray(data.posts) ? data.posts : [];
        let topicSlugs = {};
        let topics = data && Array.isArray(data.topics) ? data.topics : [];
        topics.forEach((topic) => {
            if (topic && topic.id && topic.slug) topicSlugs[String(topic.id)] = topic.slug;
        });
        let currentTopicSlug = getTopicSlugFromPath(window.location.pathname);

        return posts.map((post) => {
            let topicSlug = normalizeTitleText(post.topic_slug) ||
                topicSlugs[String(post.topic_id)] ||
                currentTopicSlug;
            let result = {
                author: normalizeTitleText(post.name) || normalizeTitleText(post.username) || '未知用户',
                blurb: stripHtmlToText(post.blurb),
                createdAt: post.created_at || '',
                flatUrl: '',
                id: post.id,
                nestedUrl: '',
                postNumber: post.post_number,
                topicId: post.topic_id,
                username: normalizeTitleText(post.username),
            };
            result.flatUrl = getTopicSearchFlatUrl(result, topicSlug);
            result.nestedUrl = getTopicSearchNestedUrl(result, topicSlug);
            return result;
        }).filter((result) => result.topicId && result.postNumber && result.flatUrl && result.nestedUrl);
    }

    function shouldBypassNestedRewrite(link) {
        return !!(link && link.dataset && link.dataset.linuxdoTopicSearchFlat === 'true');
    }

    function isNestedTopicSearchLink(link) {
        return !!(link && link.dataset && link.dataset.linuxdoTopicSearchNested === 'true');
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
        let cleanTopicId = normalizeTitleText(topicId);
        if (!storage || !cleanTopicId) return;
        storage.setItem(ALLOW_FLAT_TOPIC_KEY, JSON.stringify({
            expiresAt: Date.now() + FLAT_VIEW_BYPASS_TTL_MS,
            topicId: cleanTopicId,
        }));
    }

    function parseFlatViewBypass(rawValue) {
        let rawText = normalizeTitleText(rawValue);
        if (!rawText) return null;

        try {
            let value = JSON.parse(rawText);
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

            return {
                expiresAt: Number(value.expiresAt) || 0,
                topicId: normalizeTitleText(value.topicId),
            };
        } catch (e) {
            return {
                expiresAt: Date.now() + FLAT_VIEW_BYPASS_TTL_MS,
                shouldMigrate: true,
                topicId: rawText,
            };
        }
    }

    function forgetFlatViewBypass() {
        let storage = getSessionStorage();
        if (storage) storage.removeItem(ALLOW_FLAT_TOPIC_KEY);
    }

    function shouldKeepFlatViewBypass(topicId) {
        let storage = getSessionStorage();
        let cleanTopicId = normalizeTitleText(topicId);
        if (!storage || !cleanTopicId) return false;

        let record = parseFlatViewBypass(storage.getItem(ALLOW_FLAT_TOPIC_KEY));
        if (!record || !record.topicId) {
            storage.removeItem(ALLOW_FLAT_TOPIC_KEY);
            return false;
        }

        if (record.topicId !== cleanTopicId || (record.expiresAt && record.expiresAt < Date.now())) {
            storage.removeItem(ALLOW_FLAT_TOPIC_KEY);
            return false;
        }

        if (record.shouldMigrate) {
            storage.setItem(ALLOW_FLAT_TOPIC_KEY, JSON.stringify({
                expiresAt: record.expiresAt,
                topicId: record.topicId,
            }));
        }

        return true;
    }

    function rememberNestedFloorBypass(topicId) {
        let storage = getSessionStorage();
        if (!storage || !topicId) return;
        storage.setItem(ALLOW_NESTED_FLOOR_TOPIC_KEY, topicId);
    }

    function rememberTopicSearchTarget(link) {
        let storage = getSessionStorage();
        if (!storage || !link || !link.dataset) return;

        let target = {
            expiresAt: Date.now() + 60000,
            postId: normalizeTitleText(link.dataset.linuxdoPostId),
            postNumber: normalizeTitleText(link.dataset.linuxdoPostNumber),
            topicId: normalizeTitleText(link.dataset.linuxdoTopicId),
        };

        if (!target.topicId || (!target.postId && !target.postNumber)) return;
        handledTopicSearchTargetKey = '';
        storage.setItem(TOPIC_SEARCH_TARGET_KEY, JSON.stringify(target));
    }

    function getStoredTopicSearchTarget() {
        let storage = getSessionStorage();
        if (!storage) return null;

        let rawTarget = storage.getItem(TOPIC_SEARCH_TARGET_KEY);
        if (!rawTarget) return null;

        try {
            let target = JSON.parse(rawTarget);
            if (!target || !target.topicId || target.expiresAt < Date.now()) {
                storage.removeItem(TOPIC_SEARCH_TARGET_KEY);
                return null;
            }
            return target;
        } catch (e) {
            storage.removeItem(TOPIC_SEARCH_TARGET_KEY);
            return null;
        }
    }

    function forgetTopicSearchTarget() {
        let storage = getSessionStorage();
        if (storage) storage.removeItem(TOPIC_SEARCH_TARGET_KEY);
    }

    function getUrlTopicSearchTarget() {
        try {
            let url = new URL(window.location.href);
            if (!url.pathname.startsWith('/n/')) return null;

            let topicId = getTopicIdFromPath(url.pathname);
            let postId = normalizeTitleText(url.searchParams.get('linuxdo_search_post_id'));
            let postNumber = normalizeTitleText(url.searchParams.get('linuxdo_search_post_number'));
            if (!topicId || (!postId && !postNumber)) return null;

            return { topicId, postId, postNumber };
        } catch (e) {
            return null;
        }
    }

    function getPostNumberFromNestedPath(pathname) {
        let match = normalizeTitleText(pathname).match(/^\/n\/(?:[^/]+\/)?\d+\/(\d+)(?:\/|$)/);
        return match ? match[1] : '';
    }

    function getPostNumberFromNestedUrl(urlValue) {
        try {
            return getPostNumberFromNestedPath(new URL(urlValue, window.location.origin).pathname);
        } catch (e) {
            return '';
        }
    }

    function getPostNumberFromTopicPath(pathname) {
        let match = normalizeTitleText(pathname).match(/^\/t\/(?:[^/]+\/)?\d+\/(\d+)(?:\/|$)/);
        return match ? match[1] : '';
    }

    function getPostNumberFromTopicUrl(urlValue) {
        try {
            return getPostNumberFromTopicPath(new URL(urlValue, window.location.origin).pathname);
        } catch (e) {
            return '';
        }
    }

    function getFullTopicUrl(originalUrl) {
        try {
            let isPathRelative = originalUrl.startsWith('/') && !originalUrl.startsWith('//');
            let url = new URL(originalUrl, window.location.origin);

            if (/^\/t\/[^/]+\/\d+\/\d+\/?$/.test(url.pathname)) {
                url.pathname = url.pathname.replace(/^\/t\/([^/]+)\/(\d+)\/\d+\/?$/, '/t/$1/$2');
            } else if (/^\/t\/\d+\/\d+\/?$/.test(url.pathname)) {
                url.pathname = url.pathname.replace(/^\/t\/(\d+)\/\d+\/?$/, '/t/$1');
            }

            return isPathRelative ? url.pathname + url.search + url.hash : url.href;
        } catch (e) {
            return originalUrl;
        }
    }

    function getFlatTopicUrl(originalUrl) {
        try {
            let isPathRelative = originalUrl.startsWith('/') && !originalUrl.startsWith('//');
            let url = new URL(originalUrl, window.location.origin);

            if (url.pathname.startsWith('/n/')) {
                url.pathname = url.pathname.replace(/^\/n\//, '/t/');
                url.searchParams.delete('sort');
                return isPathRelative ? url.pathname + url.search + url.hash : url.href;
            }
        } catch (e) {
            console.error("树形评论区脚本平面 URL 解析出错:", e);
        }
        return originalUrl;
    }

    function getFlatViewUrl(originalUrl) {
        try {
            let isPathRelative = originalUrl.startsWith('/') && !originalUrl.startsWith('//');
            let url = new URL(originalUrl, window.location.origin);
            url.searchParams.set(FLAT_VIEW_URL_PARAM, '1');
            return isPathRelative ? url.pathname + url.search + url.hash : url.href;
        } catch (e) {
            console.error("树形评论区脚本平面标记 URL 解析出错:", e);
            return originalUrl;
        }
    }

    function isTopicListNavigationLink(link, href) {
        return !!(
            link &&
            getPostNumberFromTopicUrl(href) &&
            isTopicListContext(link)
        );
    }

    function getUrlNestedFloorTarget() {
        try {
            let url = new URL(window.location.href);
            if (!url.pathname.startsWith('/n/')) return null;

            let topicId = getTopicIdFromPath(url.pathname);
            let postNumber = getPostNumberFromNestedPath(url.pathname);
            if (!topicId || !postNumber) return null;

            return { topicId, postNumber };
        } catch (e) {
            return null;
        }
    }

    function getPendingTopicSearchTarget() {
        return getStoredTopicSearchTarget() || getUrlTopicSearchTarget() || getUrlNestedFloorTarget();
    }

    function consumeNestedFloorBypass(topicId) {
        let storage = getSessionStorage();
        if (!storage || !topicId) return false;

        let storedTopicId = storage.getItem(ALLOW_NESTED_FLOOR_TOPIC_KEY);
        if (!storedTopicId) return false;

        storage.removeItem(ALLOW_NESTED_FLOOR_TOPIC_KEY);
        return storedTopicId === topicId;
    }

    function consumeFlatViewUrlFlag(topicId) {
        try {
            let url = new URL(window.location.href);
            if (!url.searchParams.has(FLAT_VIEW_URL_PARAM)) return false;

            rememberFlatViewBypass(topicId || getTopicIdFromPath(url.pathname));
            url.searchParams.delete(FLAT_VIEW_URL_PARAM);
            if (window.history && typeof window.history.replaceState === 'function') {
                window.history.replaceState(null, document.title, url.pathname + url.search + url.hash);
            }
            return true;
        } catch (e) {
            console.error('树形评论区脚本处理平面视图标记失败:', e);
            return false;
        }
    }

    function isFlatViewLink(link) {
        let label = normalizeTitleText([
            link.textContent,
            link.getAttribute('title'),
            link.getAttribute('aria-label'),
        ].filter(Boolean).join(' ')).toLowerCase();

        return label.includes('view as flat') ||
            label.includes('以平面方式查看') ||
            label.includes('平面方式查看') ||
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

    function fetchTopicDataForNestedRewrite(topicId) {
        if (!topicId || typeof fetch !== 'function') return Promise.resolve(null);
        if (topicDataRequests[topicId]) return topicDataRequests[topicId];

        topicDataRequests[topicId] = fetch(`/t/${topicId}.json`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then((response) => {
                if (!response || !response.ok) return null;
                return response.json();
            })
            .then((data) => {
                rememberTopicTitle(topicId, data && data.title);
                return data && typeof data === 'object' ? data : null;
            })
            .catch((e) => {
                console.error('树形评论区脚本获取话题数据失败:', e);
                return null;
            })
            .then((data) => {
                delete topicDataRequests[topicId];
                return data;
            });

        return topicDataRequests[topicId];
    }

    function restoreTopicTitleIfNeeded() {
        if (!window.location.pathname.startsWith('/n/')) return false;

        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        let topicTitle = pendingTopicId === currentTopicId ? pendingTopicTitle : '';
        if (!topicTitle) topicTitle = getRememberedTopicTitle(currentTopicId);
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

    function findTopicSearchTargetElement(target) {
        let selectors = getTopicSearchTargetSelectors(target);
        for (let selector of selectors) {
            let node = document.querySelector(selector);
            if (!node) continue;
            return node.closest('article, .topic-post, .post-stream-item, .boxed, .reply') || node;
        }
        return null;
    }

    function scrollToTopicSearchTarget() {
        if (!window.location.pathname.startsWith('/n/')) return false;

        let target = getPendingTopicSearchTarget();
        if (!target) return false;

        let targetKey = getTopicSearchTargetKey(target);
        if (targetKey && targetKey === handledTopicSearchTargetKey) return false;

        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        if (target.topicId && currentTopicId && target.topicId !== currentTopicId) return false;

        let targetNode = findTopicSearchTargetElement(target);
        if (!targetNode) return false;

        if (targetNode.classList) targetNode.classList.add('linuxdo-topic-search-target-hit');
        targetNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => {
            if (targetNode.classList) targetNode.classList.remove('linuxdo-topic-search-target-hit');
        }, 2600);
        handledTopicSearchTargetKey = targetKey;
        forgetTopicSearchTarget();
        return true;
    }

    function scheduleTopicSearchTargetScroll() {
        [100, 350, 800, 1500, 3000, 5000].forEach((delay) => {
            setTimeout(scrollToTopicSearchTarget, delay);
        });
    }

    // 核心转换逻辑：处理链接替换，并保留楼层号用于定位。
    function getNestedUrl(originalUrl) {
        try {
            let isPathRelative = originalUrl.startsWith('/') && !originalUrl.startsWith('//');
            let url = new URL(originalUrl, window.location.origin);

            if (url.pathname.startsWith('/t/')) {
                let newPath = url.pathname;

                // 1. 匹配带 slug 的标准链接: /t/话题名/帖子ID/楼层号
                if (/^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(newPath)) {
                    newPath = newPath.replace(/^\/t\/([^/]+)\/(\d+)(?:\/(\d+))?\/?$/, (match, slug, topicId, postNumber) => {
                        return postNumber ? `/n/${slug}/${topicId}/${postNumber}` : `/n/${slug}/${topicId}`;
                    });
                }
                // 2. 匹配无 slug 的短链接: /t/帖子ID/楼层号
                else if (/^\/t\/\d+(?:\/\d+)?\/?$/.test(newPath)) {
                    newPath = newPath.replace(/^\/t\/(\d+)(?:\/(\d+))?\/?$/, (match, topicId, postNumber) => {
                        return postNumber ? `/n/${topicId}/${postNumber}` : `/n/${topicId}`;
                    });
                } else {
                    newPath = newPath.replace(/^\/t\//, '/n/');
                }

                url.pathname = newPath;
                if (!url.searchParams.has('sort')) url.searchParams.set('sort', 'old');
                return isPathRelative ? url.pathname + url.search + url.hash : url.href;
            }
        } catch (e) {
            console.error("树形评论区脚本 URL 解析出错:", e);
        }
        return originalUrl;
    }

    function isTopicLinkHref(href) {
        return !!(href && isKnownTopicUrl(href));
    }

    function isNestedTopicHref(href) {
        try {
            let url = new URL(href, window.location.origin);
            return url.pathname.startsWith('/n/') && !!getTopicIdFromPath(url.pathname);
        } catch (e) {
            return false;
        }
    }

    function markTopicNavigationIntent(link, targetHref) {
        pendingTopicId = getTopicIdFromUrl(targetHref);
        pendingTopicTitle = getTopicTitleFromLink(link);
        forceScrollTop = shouldForceScrollTopForTopicNavigation(targetHref);
        if (!forceScrollTop) scheduleTopicSearchTargetScroll();
        scheduleTitleRestore();
        setTimeout(() => { forceScrollTop = false; }, 5000);
    }

    function shouldForceScrollTopForTopicNavigation(targetHref) {
        return !getPostNumberFromNestedUrl(targetHref);
    }

    function applyNestedRewriteToLink(link, originalHref, nestedHref) {
        if (nestedHref !== originalHref) link.setAttribute('href', nestedHref);
        markTopicNavigationIntent(link, nestedHref);
    }

    function shouldHardNavigateCrossTopicFromNested(targetTopicId) {
        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        return !!(
            window.location.pathname.startsWith('/n/') &&
            currentTopicId &&
            targetTopicId &&
            currentTopicId !== targetTopicId
        );
    }

    function hardNavigateToHref(href) {
        if (!href) return false;
        if (window.location && typeof window.location.assign === 'function') {
            window.location.assign(href);
        } else {
            window.location.href = href;
        }
        return true;
    }

    function stopTopicClickForPrecheck(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (event && typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        } else if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
    }

    function replayTopicLinkClick(link) {
        if (!link) return;
        if (link.dataset) link.dataset[NESTED_REWRITE_PRECHECKED_KEY] = 'true';

        if (typeof link.click === 'function') {
            link.click();
            return;
        }

        let href = typeof link.getAttribute === 'function' ? link.getAttribute('href') : '';
        if (href) window.location.href = href;
    }

    function precheckAndReplayTopicLink(link, originalHref, nestedHref, options) {
        options = options || {};
        let topicId = getTopicIdFromUrl(originalHref);
        if (!topicId) {
            applyNestedRewriteToLink(link, originalHref, nestedHref);
            if (options.forceHardNavigation && hardNavigateToHref(nestedHref)) return;
            replayTopicLinkClick(link);
            return;
        }

        let hardNavigateAfterPrecheck = options.forceHardNavigation || shouldHardNavigateCrossTopicFromNested(topicId);
        fetchTopicDataForNestedRewrite(topicId).then((topicData) => {
            if (!topicData || isUnsupportedNestedTopicData(topicData)) {
                if (topicData) rememberFlatViewBypass(topicId);
                if (originalHref && link && typeof link.setAttribute === 'function') {
                    link.setAttribute('href', originalHref);
                }
                if (hardNavigateAfterPrecheck && hardNavigateToHref(originalHref)) return;
                replayTopicLinkClick(link);
                return;
            }

            applyNestedRewriteToLink(link, originalHref, nestedHref);
            if (hardNavigateAfterPrecheck && hardNavigateToHref(nestedHref)) return;
            replayTopicLinkClick(link);
        });
    }

    function injectTopicSearchStyles() {
        if (!document.head || document.getElementById(TOPIC_SEARCH_STYLE_ID)) return;

        let style = document.createElement('style');
        style.id = TOPIC_SEARCH_STYLE_ID;
        style.textContent = `
            .linuxdo-topic-search-entry {
                display: inline-flex;
                align-items: center;
            }

            .linuxdo-topic-search-button svg {
                width: 1em;
                height: 1em;
            }

            .linuxdo-topic-search-button {
                font-weight: 700;
                line-height: 1;
            }

            .linuxdo-topic-search-menu {
                position: absolute;
                top: calc(100% + 0.25rem);
                right: 0;
                z-index: 1201;
                min-width: 10rem;
                margin: 0;
                padding: 0.35rem;
                border: 1px solid var(--primary-low, #d6d6d6);
                border-radius: 6px;
                background: var(--secondary, #fff);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
                list-style: none;
            }

            .linuxdo-topic-search-menu[hidden] {
                display: none;
            }

            .linuxdo-topic-search-entry {
                position: relative;
            }

            .linuxdo-topic-search-menu button {
                display: block;
                width: 100%;
                border: 0;
                border-radius: 4px;
                background: transparent;
                color: var(--primary, #222);
                cursor: pointer;
                font: inherit;
                padding: 0.5rem 0.65rem;
                text-align: left;
                white-space: nowrap;
            }

            .linuxdo-topic-search-menu button:hover,
            .linuxdo-topic-search-menu button:focus {
                background: var(--primary-very-low, #f7f7f7);
                outline: none;
            }

            #${TOPIC_SEARCH_PANEL_ID} {
                position: fixed;
                top: 3.75rem;
                right: 1rem;
                width: min(28rem, calc(100vw - 2rem));
                max-height: min(38rem, calc(100vh - 5rem));
                z-index: 1200;
                display: flex;
                flex-direction: column;
                border: 1px solid var(--primary-low, #d6d6d6);
                border-radius: 8px;
                background: var(--secondary, #fff);
                color: var(--primary, #222);
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
                overflow: hidden;
            }

            #${TOPIC_SEARCH_PANEL_ID}[hidden] {
                display: none;
            }

            .linuxdo-topic-search-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.75rem;
                padding: 0.75rem 0.875rem;
                border-bottom: 1px solid var(--primary-low, #d6d6d6);
                font-weight: 600;
            }

            .linuxdo-topic-search-close {
                border: 0;
                background: transparent;
                color: inherit;
                cursor: pointer;
                font-size: 1.25rem;
                line-height: 1;
                padding: 0.125rem 0.25rem;
            }

            .linuxdo-topic-search-form {
                display: flex;
                gap: 0.5rem;
                padding: 0.75rem 0.875rem;
                border-bottom: 1px solid var(--primary-low, #d6d6d6);
            }

            .linuxdo-topic-search-input {
                flex: 1;
                min-width: 0;
                border: 1px solid var(--primary-low-mid, #bdbdbd);
                border-radius: 6px;
                background: var(--secondary, #fff);
                color: var(--primary, #222);
                font: inherit;
                padding: 0.45rem 0.6rem;
            }

            .linuxdo-topic-search-submit {
                border: 0;
                border-radius: 6px;
                background: var(--tertiary, #0088cc);
                color: var(--secondary, #fff);
                cursor: pointer;
                font: inherit;
                font-weight: 600;
                padding: 0.45rem 0.75rem;
                white-space: nowrap;
            }

            .linuxdo-topic-search-status {
                padding: 0.65rem 0.875rem;
                color: var(--primary-medium, #666);
                font-size: 0.9rem;
            }

            .linuxdo-topic-search-results {
                margin: 0;
                padding: 0;
                overflow: auto;
                list-style: none;
            }

            .linuxdo-topic-search-result {
                display: block;
                padding: 0.75rem 0.875rem;
                border-top: 1px solid var(--primary-low, #d6d6d6);
                color: inherit;
            }

            .linuxdo-topic-search-meta {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-bottom: 0.35rem;
                color: var(--primary-medium, #666);
                font-size: 0.82rem;
            }

            .linuxdo-topic-search-post {
                color: var(--tertiary, #0088cc);
                font-weight: 600;
            }

            .linuxdo-topic-search-blurb {
                color: var(--primary, #222);
                font-size: 0.94rem;
                line-height: 1.45;
            }

            .linuxdo-topic-search-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
                margin-top: 0.65rem;
            }

            .linuxdo-topic-search-action {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-height: 2rem;
                border: 1px solid var(--primary-low-mid, #bdbdbd);
                border-radius: 6px;
                color: var(--primary, #222);
                font-size: 0.86rem;
                font-weight: 600;
                line-height: 1.2;
                padding: 0.35rem 0.65rem;
                text-decoration: none;
            }

            .linuxdo-topic-search-action:hover,
            .linuxdo-topic-search-action:focus {
                background: var(--primary-very-low, #f7f7f7);
                outline: none;
            }

            .linuxdo-topic-search-action-flat {
                border-color: var(--tertiary, #0088cc);
                color: var(--tertiary, #0088cc);
            }

            .linuxdo-topic-search-target-hit {
                outline: 2px solid var(--tertiary, #0088cc);
                outline-offset: 4px;
                scroll-margin-top: 5rem;
            }

            @media (max-width: 600px) {
                #${TOPIC_SEARCH_PANEL_ID} {
                    top: 3.25rem;
                    right: 0.5rem;
                    width: calc(100vw - 1rem);
                }
            }
        `;
        document.head.appendChild(style);
    }

    function findHeaderSearchEntry() {
        let selectors = [
            '.d-header-icons .search-dropdown',
            '.d-header-icons #search-button',
            '.d-header-icons button[aria-label*="搜索"]',
            '.d-header-icons button[title*="搜索"]',
            '.d-header-icons button[aria-label*="Search"]',
            '.d-header-icons button[title*="Search"]',
            '#search-button',
            '.search-dropdown',
        ];

        for (let selector of selectors) {
            let node = document.querySelector(selector);
            if (!node) continue;
            return node.closest ? node.closest('li, .header-dropdown-toggle') || node : node;
        }

        return null;
    }

    function getCurrentTopicSearchId() {
        return shouldShowTopicSearchButton(window.location.pathname) ?
            getTopicIdFromPath(window.location.pathname) :
            '';
    }

    function createTopicSearchButton() {
        let entry = document.createElement('li');
        entry.id = TOPIC_SEARCH_BUTTON_ID;
        entry.className = 'header-dropdown-toggle linuxdo-topic-search-entry';

        let button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn no-text btn-icon linuxdo-topic-search-button';
        button.title = 'LINUX DO 话题工具';
        button.setAttribute('aria-label', 'LINUX DO 话题工具');
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.textContent = 'L';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleTopicActionMenu();
        });

        entry.appendChild(button);
        return entry;
    }

    function refreshTopicSearchUi() {
        let existingEntry = document.getElementById(TOPIC_SEARCH_BUTTON_ID);
        if (!document.body || !shouldShowTopicSearchButton(window.location.pathname)) {
            if (existingEntry) existingEntry.remove();
            closeTopicSearchPanel();
            closeTopicActionMenu();
            return;
        }

        injectTopicSearchStyles();
        if (existingEntry) return;

        let headerSearchEntry = findHeaderSearchEntry();
        if (!headerSearchEntry || !headerSearchEntry.parentNode) return;

        let entry = createTopicSearchButton();
        headerSearchEntry.parentNode.insertBefore(entry, headerSearchEntry.nextSibling);
    }

    function getTopicActionButton() {
        let entry = document.getElementById(TOPIC_SEARCH_BUTTON_ID);
        return entry ? entry.querySelector('.linuxdo-topic-search-button') : null;
    }

    function setTopicActionMenuExpanded(isExpanded) {
        let button = getTopicActionButton();
        if (button) button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function ensureTopicActionMenu() {
        let entry = document.getElementById(TOPIC_SEARCH_BUTTON_ID);
        if (!entry) return null;

        let existingMenu = document.getElementById(TOPIC_SEARCH_MENU_ID);
        if (existingMenu) return existingMenu;

        let menu = document.createElement('ul');
        menu.id = TOPIC_SEARCH_MENU_ID;
        menu.className = 'linuxdo-topic-search-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <li role="none"><button type="button" role="menuitem" data-linuxdo-topic-action="search">本话题搜索</button></li>
            <li role="none"><button type="button" role="menuitem" data-linuxdo-topic-action="flat">以平面方式查看</button></li>
        `;
        menu.addEventListener('click', (event) => {
            let actionButton = event.target && event.target.closest ? event.target.closest('button[data-linuxdo-topic-action]') : null;
            if (!actionButton) return;
            event.preventDefault();
            event.stopPropagation();

            if (actionButton.dataset.linuxdoTopicAction === 'search') {
                closeTopicActionMenu();
                openTopicSearchPanel();
            } else if (actionButton.dataset.linuxdoTopicAction === 'flat') {
                closeTopicActionMenu();
                openCurrentTopicFlatView();
            }
        });
        entry.appendChild(menu);

        document.addEventListener('click', (event) => {
            let currentEntry = document.getElementById(TOPIC_SEARCH_BUTTON_ID);
            if (menu.hidden || (currentEntry && currentEntry.contains(event.target))) return;
            closeTopicActionMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeTopicActionMenu();
        });

        return menu;
    }

    function closeTopicActionMenu() {
        let menu = document.getElementById(TOPIC_SEARCH_MENU_ID);
        if (menu) menu.hidden = true;
        setTopicActionMenuExpanded(false);
    }

    function toggleTopicActionMenu() {
        let menu = ensureTopicActionMenu();
        if (!menu) return;

        let shouldOpen = menu.hidden;
        menu.hidden = !shouldOpen;
        setTopicActionMenuExpanded(shouldOpen);
        if (shouldOpen) closeTopicSearchPanel();
    }

    function openCurrentTopicFlatView() {
        let topicId = getTopicIdFromPath(window.location.pathname);
        if (!topicId) return false;

        rememberFlatViewBypass(topicId);
        let flatUrl = getFlatViewUrl(getFlatTopicUrl(window.location.href));
        closeTopicSearchPanel();
        hardNavigateToHref(flatUrl);
        return true;
    }

    function scheduleTopicSearchUiRefresh() {
        if (topicSearchRefreshTimer) clearTimeout(topicSearchRefreshTimer);
        topicSearchRefreshTimer = setTimeout(refreshTopicSearchUi, 100);
    }

    function ensureTopicSearchPanel() {
        let existingPanel = document.getElementById(TOPIC_SEARCH_PANEL_ID);
        if (existingPanel) return existingPanel;

        injectTopicSearchStyles();

        let panel = document.createElement('section');
        panel.id = TOPIC_SEARCH_PANEL_ID;
        panel.hidden = true;
        panel.setAttribute('aria-label', '本话题搜索');
        panel.innerHTML = `
            <div class="linuxdo-topic-search-head">
                <span>本话题搜索</span>
                <button type="button" class="linuxdo-topic-search-close" aria-label="关闭">×</button>
            </div>
            <form class="linuxdo-topic-search-form">
                <input class="linuxdo-topic-search-input" type="search" autocomplete="off" placeholder="搜索本话题所有回复">
                <button class="linuxdo-topic-search-submit" type="submit">搜索</button>
            </form>
            <div class="linuxdo-topic-search-status">输入关键词后回车，搜索未加载的回复。</div>
            <ol class="linuxdo-topic-search-results"></ol>
        `;
        document.body.appendChild(panel);

        panel.querySelector('.linuxdo-topic-search-close').addEventListener('click', closeTopicSearchPanel);
        panel.querySelector('.linuxdo-topic-search-form').addEventListener('submit', (event) => {
            event.preventDefault();
            performTopicSearch(panel.querySelector('.linuxdo-topic-search-input').value);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeTopicSearchPanel();
        });

        document.addEventListener('click', (event) => {
            if (panel.hidden) return;
            let entry = document.getElementById(TOPIC_SEARCH_BUTTON_ID);
            if (panel.contains(event.target) || (entry && entry.contains(event.target))) return;
            closeTopicSearchPanel();
        });

        return panel;
    }

    function openTopicSearchPanel() {
        let topicId = getCurrentTopicSearchId();
        if (!topicId) return;

        let panel = ensureTopicSearchPanel();
        panel.dataset.topicId = topicId;
        panel.hidden = false;
        setTopicSearchStatus('输入关键词后回车，搜索未加载的回复。');

        let input = panel.querySelector('.linuxdo-topic-search-input');
        if (input) {
            input.focus();
            input.select();
        }
    }

    function closeTopicSearchPanel() {
        let panel = document.getElementById(TOPIC_SEARCH_PANEL_ID);
        if (panel) panel.hidden = true;
        if (topicSearchAbortController) {
            topicSearchAbortController.abort();
            topicSearchAbortController = null;
        }
    }

    function toggleTopicSearchPanel() {
        let panel = document.getElementById(TOPIC_SEARCH_PANEL_ID);
        if (panel && !panel.hidden) {
            closeTopicSearchPanel();
        } else {
            openTopicSearchPanel();
        }
    }

    function setTopicSearchStatus(message) {
        let panel = document.getElementById(TOPIC_SEARCH_PANEL_ID);
        if (!panel) return;
        let status = panel.querySelector('.linuxdo-topic-search-status');
        if (status) status.textContent = message;
    }

    function clearTopicSearchResults() {
        let panel = document.getElementById(TOPIC_SEARCH_PANEL_ID);
        if (!panel) return;
        let list = panel.querySelector('.linuxdo-topic-search-results');
        if (list) list.textContent = '';
    }

    function renderTopicSearchResults(results) {
        let panel = document.getElementById(TOPIC_SEARCH_PANEL_ID);
        if (!panel) return;

        let list = panel.querySelector('.linuxdo-topic-search-results');
        if (!list) return;

        list.textContent = '';

        results.forEach((result) => {
            let item = document.createElement('li');
            let resultBody = document.createElement('div');
            let meta = document.createElement('div');
            let post = document.createElement('span');
            let author = document.createElement('span');
            let blurb = document.createElement('div');
            let actions = document.createElement('div');
            let nestedLink = document.createElement('a');
            let flatLink = document.createElement('a');

            resultBody.className = 'linuxdo-topic-search-result';

            meta.className = 'linuxdo-topic-search-meta';
            post.className = 'linuxdo-topic-search-post';
            post.textContent = `#${result.postNumber}`;
            author.textContent = result.author;

            blurb.className = 'linuxdo-topic-search-blurb';
            blurb.textContent = result.blurb || '无摘要';

            actions.className = 'linuxdo-topic-search-actions';

            nestedLink.className = 'linuxdo-topic-search-action linuxdo-topic-search-action-nested';
            nestedLink.href = result.nestedUrl;
            nestedLink.dataset.linuxdoTopicSearchNested = 'true';
            nestedLink.dataset.linuxdoTopicId = result.topicId;
            nestedLink.dataset.linuxdoPostId = result.id;
            nestedLink.dataset.linuxdoPostNumber = result.postNumber;
            nestedLink.textContent = '嵌套查看';
            nestedLink.title = `以嵌套评论区打开第 ${result.postNumber} 楼`;

            flatLink.className = 'linuxdo-topic-search-action linuxdo-topic-search-action-flat';
            flatLink.href = getFlatViewUrl(result.flatUrl);
            flatLink.dataset.linuxdoTopicSearchFlat = 'true';
            flatLink.textContent = '平面查看';
            flatLink.title = `以平面图打开第 ${result.postNumber} 楼`;

            meta.appendChild(post);
            meta.appendChild(author);
            actions.appendChild(nestedLink);
            actions.appendChild(flatLink);
            resultBody.appendChild(meta);
            resultBody.appendChild(blurb);
            resultBody.appendChild(actions);
            item.appendChild(resultBody);
            list.appendChild(item);
        });
    }

    function performTopicSearch(keyword) {
        let topicId = getCurrentTopicSearchId();
        let endpoint = buildTopicSearchEndpoint(topicId, keyword);
        if (!endpoint) {
            clearTopicSearchResults();
            setTopicSearchStatus('请输入要搜索的关键词。');
            return;
        }

        if (topicSearchAbortController) topicSearchAbortController.abort();
        topicSearchAbortController = typeof AbortController === 'function' ? new AbortController() : null;

        clearTopicSearchResults();
        setTopicSearchStatus('正在搜索本话题...');

        fetch(endpoint, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: topicSearchAbortController ? topicSearchAbortController.signal : undefined,
        })
            .then((response) => {
                if (!response || !response.ok) {
                    throw new Error(`搜索请求失败: ${response ? response.status : 'unknown'}`);
                }
                return response.json();
            })
            .then((data) => {
                let error = data && data.grouped_search_result && data.grouped_search_result.error;
                if (error) throw new Error(error);

                let results = normalizeTopicSearchResults(data);
                renderTopicSearchResults(results);
                setTopicSearchStatus(results.length ? `找到 ${results.length} 条结果。嵌套查看直接打开树形楼层，平面查看打开平面楼层。` : '没有找到匹配结果。');
            })
            .catch((error) => {
                if (error && error.name === 'AbortError') return;
                clearTopicSearchResults();
                setTopicSearchStatus(error && error.message ? error.message : '搜索失败，请稍后再试。');
                console.error('树形评论区脚本话题内搜索失败:', error);
            });
    }

    function installTopicSearchNavigationHooks() {
        if (topicSearchNavigationHooksInstalled || !window.history) return;
        topicSearchNavigationHooksInstalled = true;

        ['pushState', 'replaceState'].forEach((methodName) => {
            let originalMethod = window.history[methodName];
            if (typeof originalMethod !== 'function') return;

            window.history[methodName] = function () {
                let result = originalMethod.apply(this, arguments);
                scheduleTopicSearchUiRefresh();
                scheduleTopicSearchTargetScroll();
                redirectToNestedTopicIfAllowed();
                return result;
            };
        });

        window.addEventListener('popstate', () => {
            scheduleTopicSearchUiRefresh();
            scheduleTopicSearchTargetScroll();
            redirectToNestedTopicIfAllowed();
        });
    }

    function observeTopicSearchHeader() {
        if (topicSearchObserver || !document.body) return;
        topicSearchObserver = new MutationObserver(() => {
            scheduleTopicSearchUiRefresh();
            scrollToTopicSearchTarget();
        });
        topicSearchObserver.observe(document.body, { childList: true, subtree: true });
    }

    function runWhenBodyReady(callback) {
        if (document.body) {
            callback();
        } else {
            window.addEventListener('DOMContentLoaded', callback);
        }
    }

    function redirectToNestedTopicIfAllowed() {
        let currentTopicId = getTopicIdFromPath(window.location.pathname);
        if (!currentTopicId) return;
        if (consumeFlatViewUrlFlag(currentTopicId) || shouldKeepFlatViewBypass(currentTopicId) || consumeNestedFloorBypass(currentTopicId)) return;
        if (isPrivateMessageTopicPage()) return;

        let targetUrl = getNestedUrl(window.location.href);
        if (targetUrl === window.location.href) return;

        fetchTopicDataForNestedRewrite(currentTopicId).then((topicData) => {
            if (!topicData || isUnsupportedNestedTopicData(topicData)) return;
            if (!window.location.pathname.startsWith('/t/')) return;
            if (getTopicIdFromPath(window.location.pathname) !== currentTopicId) return;

            let freshTargetUrl = getNestedUrl(window.location.href);
            if (freshTargetUrl !== window.location.href) window.location.replace(freshTargetUrl);
        });
    }

    // 1. 处理页面初次加载或外部直接跳转
    if (window.location.pathname.startsWith('/t/')) {
        redirectToNestedTopicIfAllowed();
    }

    // 2. 拦截单页应用(SPA)内的所有链接点击
    window.addEventListener('click', function (e) {
        let a = findTopicNavigationElement(e.target);
        if (!a) return;

        let href = getElementNavigationHref(a);
        if (!href) return;

        if (isNestedTopicHref(href)) forgetFlatViewBypass();

        if (isNestedTopicSearchLink(a)) {
            rememberNestedFloorBypass(getTopicIdFromUrl(href));
            closeTopicSearchPanel();
            return;
        }

        // 搜索结果需要精确打开对应楼层，因此允许这类链接临时使用 Discourse 原始平面话题地址。
        if (shouldBypassNestedRewrite(a)) {
            rememberFlatViewBypass(getTopicIdFromUrl(href));
            return;
        }

        // 防死循环：允许用户主动点击切回平铺模式(View as flat / 以平面图查看)
        if (isFlatViewLink(a)) {
            rememberFlatViewBypass(getTopicIdFromUrl(href));
            return;
        }

        // 如果点击的是帖子链接
        let topicNavigationTarget = getTopicNavigationTarget(a);
        if (topicNavigationTarget) {
            href = topicNavigationTarget.href;
            if (a.dataset && a.dataset[NESTED_REWRITE_PRECHECKED_KEY] === 'true') {
                delete a.dataset[NESTED_REWRITE_PRECHECKED_KEY];
                return;
            }

            if (shouldSkipNestedRewriteForUnsupportedTopic(a)) return;
            if (shouldKeepCanonicalTopicLink(e, a)) return;

            if (isTopicListNavigationLink(a, href)) href = getFullTopicUrl(href);

            let newHref = getNestedUrl(href);
            if (newHref === href) return;

            let forceHardNavigation = topicNavigationTarget.source !== 'href';
            if (getTopicIdFromUrl(href) && typeof fetch === 'function') {
                stopTopicClickForPrecheck(e);
                precheckAndReplayTopicLink(a, href, newHref, { forceHardNavigation });
                return;
            }

            applyNestedRewriteToLink(a, href, newHref);
            if (forceHardNavigation) {
                stopTopicClickForPrecheck(e);
                hardNavigateToHref(newHref);
            }
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

    installTopicSearchNavigationHooks();
    runWhenBodyReady(() => {
        refreshTopicSearchUi();
        observeTopicSearchHeader();
        scheduleTopicSearchTargetScroll();
    });

    if (typeof window.__LINUXDO_COMMENT_TEST_HOOK__ === 'function') {
        window.__LINUXDO_COMMENT_TEST_HOOK__({
            buildTopicSearchEndpoint,
            getTopicSearchTargetSelectors,
            isPrivateMessageTopicData,
            isPrivateMessageTopicPage,
            isNestedTopicSearchLink,
            isUnsupportedNestedTopicData,
            getDocumentTitle: () => document.title,
            getFlatTopicUrl,
            getFlatViewUrl,
            rememberTopicTitle,
            normalizeTopicSearchResults,
            openCurrentTopicFlatView,
            shouldBypassNestedRewrite,
            shouldKeepCanonicalTopicLink,
            shouldSkipNestedRewriteForPrivateMessage,
            shouldSkipNestedRewriteForUnsupportedTopic,
            shouldForceScrollTopForTopicNavigation,
            shouldShowTopicSearchButton,
            restoreTopicTitleIfNeeded,
            scrollToTopicSearchTarget,
        });
    }
})();
