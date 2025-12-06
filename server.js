const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');

let playwright;
try {
    playwright = require('playwright');
} catch (err) {
    console.error('Playwright is not installed or failed to load. Run: npm install && npx playwright install');
    throw err;
}

const { chromium } = playwright;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Configure multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

async function safeGoto(page, url) {
    try {
        // try networkidle first (may hang sometimes) then fallback to domcontentloaded
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (err1) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err2) {
            // If both fail, try with load event as last resort
            try {
                await page.goto(url, { waitUntil: 'load', timeout: 30000 });
            } catch (err3) {
                // throw the most descriptive error
                const errorMsg = err3.message || err2.message || err1.message || 'Navigation failed';
                throw new Error(`Failed to load ${url}: ${errorMsg}`);
            }
        }
    }
}

// scroll helper to trigger lazy-load content
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let total = 0;
            const distance = 500;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                total += distance;
                if (total > document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
            // safety resolve after 6s
            setTimeout(() => {
                clearInterval(timer);
                resolve();
            }, 6000);
        });
    });
}

async function extractPageContent(browser, url, includeNodeData = false) {
    const context = await browser.newContext({ 
        viewport: { width: 1280, height: 800 }, 
        ignoreHTTPSErrors: true,
        // Add more context options to help with loading
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    try {
        // Set additional headers to avoid bot detection
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });
        
        await safeGoto(page, url);
        
        // Wait for page to be ready
        await page.waitForLoadState('domcontentloaded');
        
        // short wait for dynamic content
        await page.waitForTimeout(2000);
        
        // Try to wait for network to be idle, but don't fail if it times out
        try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (e) {
            // Ignore networkidle timeout, continue anyway
        }
        
        await autoScroll(page);
        await page.waitForTimeout(500);

        const result = await page.evaluate((includeNodeData) => {
            // Extract meta tags and title BEFORE removing head elements
            const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || 
                                   document.querySelector('meta[property="og:description"]')?.getAttribute('content') || 
                                   '';
            const metaTitle = document.querySelector('title')?.textContent || 
                             document.querySelector('meta[property="og:title"]')?.getAttribute('content') || 
                             '';
            
            // remove elements that typically don't contribute to visible textual content
            const selectors = ['script', 'style', 'noscript', 'iframe', 'head', 'meta', 'link'];
            document.querySelectorAll(selectors.join(',')).forEach(n => n.remove());

            // remove hidden nodes
            document.querySelectorAll('[hidden]').forEach(n => n.remove());

            // gather visible text nodes
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    let el = node.parentElement;
                    while (el && el !== document.body) {
                        const style = window.getComputedStyle(el);
                        if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        el = el.parentElement;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            const out = [];
            const nodeData = new Map();
            let node;
            while (node = walker.nextNode()) {
                const text = node.nodeValue.replace(/\s+/g, ' ').trim();
                if (text.length > 2) {
                    out.push(text);
                    if (includeNodeData && node.parentElement) {
                        const parent = node.parentElement;
                        const rect = parent.getBoundingClientRect();
                        const computedStyle = window.getComputedStyle(parent);
                        nodeData.set(text, {
                            tagName: parent.tagName,
                            className: parent.className,
                            id: parent.id,
                            xpath: getXPath(parent),
                            rect: {
                                x: rect.x,
                                y: rect.y,
                                width: rect.width,
                                height: rect.height
                            },
                            styles: {
                                backgroundColor: computedStyle.backgroundColor,
                                color: computedStyle.color,
                                fontSize: computedStyle.fontSize,
                                fontFamily: computedStyle.fontFamily
                            }
                        });
                    }
                }
            }
            // dedupe but preserve order
            const seen = new Set();
            const uniqueLines = out.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
            
            const baseResult = {
                lines: uniqueLines,
                meta: {
                    title: metaTitle.trim(),
                    description: metaDescription.trim()
                }
            };
            
            return includeNodeData ? { ...baseResult, nodeData: Object.fromEntries(nodeData) } : baseResult;
            
            function getXPath(element) {
                if (element.id !== '') {
                    return `//*[@id="${element.id}"]`;
                }
                if (element === document.body) {
                    return '/html/body';
                }
                let ix = 0;
                const siblings = element.parentNode.childNodes;
                for (let i = 0; i < siblings.length; i++) {
                    const sibling = siblings[i];
                    if (sibling === element) {
                        return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                    }
                    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                        ix++;
                    }
                }
            }
        }, includeNodeData);

        const lines = result.lines || [];
        const nodeData = includeNodeData ? result.nodeData : null;
        const meta = result.meta || { title: '', description: '' };

        await page.close();
        await context.close();
        return { success: true, url, lines, nodeData, meta };
    } catch (err) {
        const errorMessage = err.message || String(err);
        console.error(`Error extracting content from ${url}:`, errorMessage);
        try { await page.close(); } catch (_) {}
        try { await context.close(); } catch (_) {}
        return { success: false, url, error: errorMessage };
    }
}

function buildComparison(lines1 = [], lines2 = [], meta1 = {}, meta2 = {}) {
    // Build union of unique lines while preserving first-seen order
    const union = [];
    const seen = new Set();
    for (const l of lines1) { if (!seen.has(l)) { union.push(l); seen.add(l); } }
    for (const l of lines2) { if (!seen.has(l)) { union.push(l); seen.add(l); } }

    const comparison = union.map((text, idx) => {
        const in1 = lines1.indexOf(text) !== -1;
        const in2 = lines2.indexOf(text) !== -1;
        const status = in1 && in2 ? 'match' : in1 ? 'only1' : 'only2';
        return {
            index: idx,
            line1: in1 ? text : null,
            line2: in2 ? text : null,
            status
        };
    });

    // Compare meta tags
    const metaComparison = {
        title: {
            url1: meta1.title || '',
            url2: meta2.title || '',
            match: (meta1.title || '') === (meta2.title || ''),
            status: (meta1.title || '') === (meta2.title || '') ? 'match' : 
                   (meta1.title && !meta2.title) ? 'only1' :
                   (!meta1.title && meta2.title) ? 'only2' : 'different'
        },
        description: {
            url1: meta1.description || '',
            url2: meta2.description || '',
            match: (meta1.description || '') === (meta2.description || ''),
            status: (meta1.description || '') === (meta2.description || '') ? 'match' : 
                   (meta1.description && !meta2.description) ? 'only1' :
                   (!meta1.description && meta2.description) ? 'only2' : 'different'
        }
    };

    const total = comparison.length;
    const match = comparison.filter(c => c.status === 'match').length;
    const only1 = comparison.filter(c => c.status === 'only1').length;
    const only2 = comparison.filter(c => c.status === 'only2').length;
    const different = 0; // we treat differing text as unique; for fuzzy diff implement later

    // Count meta differences
    const metaDifferences = (!metaComparison.title.match ? 1 : 0) + (!metaComparison.description.match ? 1 : 0);

    const summary = {
        total, match, only1, only2, different,
        similarity: total ? Math.round((match / total) * 100) : 0,
        metaComparison,
        metaDifferences
    };

    return { comparison, summary };
}

app.post('/api/compare', async (req, res) => {
    const { url1, url2 } = req.body || {};
    if (!url1 || !url2) return res.status(400).json({ error: 'Both url1 and url2 are required' });

    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
        console.error('Failed to launch browser:', err);
        return res.status(500).json({ error: 'Failed to launch browser. Run: npx playwright install', details: err.message });
    }

    try {
        // extract both pages in parallel
        const [r1, r2] = await Promise.all([extractPageContent(browser, url1), extractPageContent(browser, url2)]);

        if (!r1.success || !r2.success) {
            // include per-URL error details
            await browser.close();
            const errorDetails = [];
            if (!r1.success) {
                errorDetails.push(`Live URL (${url1}): ${r1.error}`);
            }
            if (!r2.success) {
                errorDetails.push(`Test URL (${url2}): ${r2.error}`);
            }
            return res.status(502).json({
                error: 'One or both pages failed to load',
                details: errorDetails.join('\n'),
                urlErrors: { url1: r1.success ? null : r1.error, url2: r2.success ? null : r2.error }
            });
        }

        const { comparison, summary } = buildComparison(r1.lines, r2.lines, r1.meta || {}, r2.meta || {});

        await browser.close();
        return res.json({
            url1, url2,
            comparison,
            summary,
            meta1: r1.meta || {},
            meta2: r2.meta || {}
        });
    } catch (err) {
        console.error('Comparison error:', err);
        try { await browser.close(); } catch (_) {}
        return res.status(500).json({ error: 'Comparison failed', details: err.message || String(err) });
    }
});

// Endpoint to get node details and screenshot
app.post('/api/node-details', async (req, res) => {
    const { url, text, side } = req.body || {};
    if (!url || !text) return res.status(400).json({ error: 'url and text are required' });

    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
        console.error('Failed to launch browser:', err);
        return res.status(500).json({ error: 'Failed to launch browser', details: err.message });
    }

    try {
        const context = await browser.newContext({ 
            viewport: { width: 1280, height: 800 }, 
            ignoreHTTPSErrors: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });
        
        await safeGoto(page, url);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
        
        try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (e) {}
        
        await autoScroll(page);
        await page.waitForTimeout(500);

        // Find element and get selector/XPath for accurate screenshot
        const elementData = await page.evaluate((searchText) => {
            // Normalize search text
            const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
            
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            let bestMatch = null;
            let exactMatch = null;
            
            while (node = walker.nextNode()) {
                if (!node.parentElement) continue;
                
                const text = node.nodeValue.replace(/\s+/g, ' ').trim();
                
                // Try exact match first
                if (text === normalizedSearch) {
                    exactMatch = node.parentElement;
                    break;
                }
                
                // Try partial match (contains the search text)
                if (!bestMatch && text.includes(normalizedSearch)) {
                    bestMatch = node.parentElement;
                }
            }
            
            const element = exactMatch || bestMatch;
            if (!element) return null;
            
            const rect = element.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(element);
            
            // Get all text content of the parent element
            const fullText = element.innerText || element.textContent || '';
            
            // Get parent's HTML structure (limited)
            const html = element.outerHTML.substring(0, 1000);
            
            // Generate unique identifier for the element
            let selector = null;
            if (element.id) {
                selector = `#${element.id}`;
            } else if (element.className && typeof element.className === 'string') {
                const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 3).join('.');
                if (classes) {
                    selector = `${element.tagName.toLowerCase()}.${classes}`;
                }
            }
            
            // Store element reference with unique marker
            const markerId = 'pw-screenshot-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            element.setAttribute('data-pw-marker', markerId);
            
            function getXPath(element) {
                if (element.id !== '') {
                    return `//*[@id="${element.id}"]`;
                }
                if (element === document.body) {
                    return '/html/body';
                }
                let ix = 0;
                const siblings = element.parentNode.childNodes;
                for (let i = 0; i < siblings.length; i++) {
                    const sibling = siblings[i];
                    if (sibling === element) {
                        return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                    }
                    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                        ix++;
                    }
                }
            }
            
            return {
                tagName: element.tagName,
                className: element.className,
                id: element.id,
                xpath: getXPath(element),
                selector: selector,
                markerId: markerId,
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                styles: {
                    backgroundColor: computedStyle.backgroundColor,
                    color: computedStyle.color,
                    fontSize: computedStyle.fontSize,
                    fontFamily: computedStyle.fontFamily,
                    fontWeight: computedStyle.fontWeight,
                    padding: computedStyle.padding,
                    margin: computedStyle.margin
                },
                fullText: fullText.substring(0, 500),
                html: html
            };
        }, text);

        if (!elementData) {
            await page.close();
            await context.close();
            await browser.close();
            return res.status(404).json({ error: 'Node not found. The text might not exist on the page or may have been modified.' });
        }

        // Scroll element into view and ensure it's fully visible
        await page.evaluate((markerId) => {
            const element = document.querySelector(`[data-pw-marker="${markerId}"]`);
            if (element) {
                // Scroll to center the element
                element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
                
                // Ensure element is fully visible (not clipped)
                const rect = element.getBoundingClientRect();
                const viewport = {
                    width: window.innerWidth,
                    height: window.innerHeight
                };
                
                // Adjust scroll if element is partially outside viewport
                if (rect.top < 0) {
                    window.scrollBy(0, rect.top - 20);
                } else if (rect.bottom > viewport.height) {
                    window.scrollBy(0, rect.bottom - viewport.height + 20);
                }
                if (rect.left < 0) {
                    window.scrollBy(rect.left - 20, 0);
                } else if (rect.right > viewport.width) {
                    window.scrollBy(rect.right - viewport.width + 20, 0);
                }
            }
        }, elementData.markerId);
        
        // Wait for scroll to complete
        await page.waitForTimeout(1000);
        
        // Wait for any animations or transitions to complete
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        
        // Additional wait for any CSS transitions
        await page.waitForTimeout(800);
        
        // Ensure element is still visible and stable
        const isVisible = await page.evaluate((markerId) => {
            const element = document.querySelector(`[data-pw-marker="${markerId}"]`);
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && 
                   rect.height > 0 && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden' &&
                   style.opacity !== '0';
        }, elementData.markerId);
        
        if (!isVisible) {
            console.warn('Element is not visible, attempting screenshot anyway...');
        }

        // Try to find element using Playwright locator for accurate screenshot
        let screenshot = null;
        let elementLocator = null;
        
        try {
            // Try to locate element by marker first (most reliable)
            elementLocator = page.locator(`[data-pw-marker="${elementData.markerId}"]`);
            
            // Wait for element to be visible and stable
            await elementLocator.waitFor({ 
                state: 'visible', 
                timeout: 5000 
            });
            
            // Ensure element has valid dimensions
            const boundingBox = await elementLocator.boundingBox();
            if (boundingBox && boundingBox.width > 0 && boundingBox.height > 0) {
                // Take screenshot of the element directly (most accurate)
                screenshot = await elementLocator.screenshot({ 
                    timeout: 10000,
                    animations: 'disabled', // Disable animations for stable screenshot
                    caret: 'hide' // Hide text cursor if present
                });
                
                console.log(`Element screenshot taken successfully: ${screenshot.length} bytes, dimensions: ${boundingBox.width}x${boundingBox.height}`);
            } else {
                throw new Error('Element has invalid dimensions');
            }
        } catch (locatorError) {
            console.warn('Locator screenshot failed, trying alternative methods:', locatorError.message);
            
            // Fallback: Try by ID
            if (elementData.id) {
                try {
                    elementLocator = page.locator(`#${elementData.id}`);
                    await elementLocator.waitFor({ state: 'visible', timeout: 3000 });
                    screenshot = await elementLocator.screenshot({ timeout: 5000, animations: 'disabled' });
                    console.log('Element screenshot taken using ID selector');
                } catch (idError) {
                    console.warn('ID selector failed:', idError.message);
                }
            }
            
            // Fallback: Try by XPath
            if (!screenshot && elementData.xpath) {
                try {
                    elementLocator = page.locator(`xpath=${elementData.xpath}`);
                    await elementLocator.waitFor({ state: 'visible', timeout: 3000 });
                    screenshot = await elementLocator.screenshot({ timeout: 5000, animations: 'disabled' });
                    console.log('Element screenshot taken using XPath');
                } catch (xpathError) {
                    console.warn('XPath selector failed:', xpathError.message);
                }
            }
            
            // Final fallback: Use page screenshot with clip
            if (!screenshot) {
                try {
                    const currentRect = await page.evaluate((markerId) => {
                        const element = document.querySelector(`[data-pw-marker="${markerId}"]`);
                        if (!element) return null;
                        const rect = element.getBoundingClientRect();
                        return {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height)
                        };
                    }, elementData.markerId);
                    
                    if (currentRect && currentRect.width > 0 && currentRect.height > 0) {
                        const padding = 20;
                        const viewport = page.viewportSize();
                        screenshot = await page.screenshot({
                            clip: {
                                x: Math.max(0, currentRect.x - padding),
                                y: Math.max(0, currentRect.y - padding),
                                width: Math.min(currentRect.width + (padding * 2), viewport.width),
                                height: Math.min(currentRect.height + (padding * 2), viewport.height)
                            },
                            animations: 'disabled'
                        });
                        console.log('Element screenshot taken using page clip');
                    }
                } catch (clipError) {
                    console.error('All screenshot methods failed:', clipError.message);
                }
            }
        }
        
        // Clean up marker attribute
        await page.evaluate((markerId) => {
            const element = document.querySelector(`[data-pw-marker="${markerId}"]`);
            if (element) {
                element.removeAttribute('data-pw-marker');
            }
        }, elementData.markerId).catch(() => {});
        
        // Prepare nodeInfo without markerId
        const nodeInfo = {
            tagName: elementData.tagName,
            className: elementData.className,
            id: elementData.id,
            xpath: elementData.xpath,
            rect: elementData.rect,
            styles: elementData.styles,
            fullText: elementData.fullText,
            html: elementData.html
        };

        await page.close();
        await context.close();
        await browser.close();

        const screenshotBase64 = screenshot ? screenshot.toString('base64') : null;
        console.log(`Screenshot ${screenshotBase64 ? 'taken' : 'failed'}: ${screenshotBase64 ? screenshotBase64.length + ' bytes' : 'N/A'}, Node found at (${nodeInfo.rect.x}, ${nodeInfo.rect.y})`);
        
        res.json({
            success: true,
            nodeInfo,
            screenshot: screenshotBase64,
            url,
            text
        });
    } catch (err) {
        console.error('Node details error:', err);
        console.error('Error stack:', err.stack);
        try { await browser.close(); } catch (_) {}
        return res.status(500).json({ 
            error: 'Failed to get node details', 
            details: err.message || String(err),
            text: req.body.text ? req.body.text.substring(0, 100) : 'N/A'
        });
    }
});

// Endpoint to view page with auto-scroll to element
app.get('/view', (req, res) => {
    const { url, xpath, id, text } = req.query;
    
    if (!url) {
        return res.status(400).send('URL parameter is required');
    }
    
    // Create an HTML page that loads the target URL and scrolls to the element
    const viewerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Viewing: ${escapeHtml(url)}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        #loading {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
        }
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        iframe {
            width: 100%;
            height: 100vh;
            border: none;
        }
        .back-button {
            position: fixed;
            top: 20px;
            left: 20px;
            z-index: 10001;
            background: #3498db;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .back-button:hover {
            background: #2980b9;
        }
    </style>
</head>
<body>
    <div id="loading">
        <div class="spinner"></div>
        <p>Loading page and scrolling to element...</p>
    </div>
    <button class="back-button" onclick="window.close()">← Back</button>
    <iframe id="pageFrame" src="${escapeHtml(url)}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"></iframe>
    <script>
        const iframe = document.getElementById('pageFrame');
        const loading = document.getElementById('loading');
        const xpath = ${xpath ? JSON.stringify(xpath) : 'null'};
        const id = ${id ? JSON.stringify(id) : 'null'};
        const text = ${text ? JSON.stringify(text) : 'null'};
        
        function scrollToElement() {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                
                let element = null;
                
                // Try to find element by ID first (fastest)
                if (id && id !== 'N/A') {
                    element = iframeDoc.getElementById(id);
                }
                
                // Try XPath if ID didn't work
                if (!element && xpath) {
                    const result = iframeDoc.evaluate(
                        xpath,
                        iframeDoc,
                        null,
                        XPathResult.FIRST_ORDERED_NODE_TYPE,
                        null
                    );
                    element = result.singleNodeValue;
                }
                
                // Try to find by text content as last resort
                if (!element && text) {
                    const walker = iframeDoc.createTreeWalker(
                        iframeDoc.body,
                        NodeFilter.SHOW_TEXT,
                        null
                    );
                    let node;
                    while (node = walker.nextNode()) {
                        const nodeText = node.nodeValue.replace(/\\s+/g, ' ').trim();
                        if (nodeText === text || nodeText.includes(text)) {
                            element = node.parentElement;
                            break;
                        }
                    }
                }
                
                if (element) {
                    // Scroll element into view
                    element.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center', 
                        inline: 'center' 
                    });
                    
                    // Highlight the element briefly
                    const originalOutline = element.style.outline;
                    const originalBackground = element.style.backgroundColor;
                    element.style.outline = '3px solid #3498db';
                    element.style.backgroundColor = 'rgba(52, 152, 219, 0.2)';
                    
                    setTimeout(() => {
                        element.style.outline = originalOutline;
                        element.style.backgroundColor = originalBackground;
                    }, 3000);
                    
                    loading.style.display = 'none';
                    console.log('Element found and scrolled into view');
                } else {
                    loading.innerHTML = '<p>Element not found on page. The page structure may have changed.</p><button onclick="window.close()">Close</button>';
                    console.warn('Element not found');
                }
            } catch (error) {
                console.error('Error scrolling to element:', error);
                const directUrl = '${escapeHtml(url)}' + (id && id !== 'N/A' ? '#' + id : '');
                const idSuffix = id && id !== 'N/A' ? ' (with #' + id + ')' : '';
                loading.innerHTML = '<div style="text-align: center; max-width: 500px;">' +
                    '<p style="margin-bottom: 20px;">⚠️ Could not access iframe content (CORS/X-Frame-Options restriction).</p>' +
                    '<p style="margin-bottom: 20px;">The website blocks embedding in iframes for security reasons.</p>' +
                    '<a href="' + directUrl + '" target="_blank" style="display: inline-block; padding: 12px 24px; background: #3498db; color: white; text-decoration: none; border-radius: 6px; margin: 10px;">' +
                    '🔗 Open Page Directly' + idSuffix + '</a><br>' +
                    '<button onclick="window.close()" style="padding: 10px 20px; margin-top: 10px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>' +
                    '</div>';
            }
        }
        
        // Wait for iframe to load
        iframe.onload = function() {
            setTimeout(() => {
                scrollToElement();
            }, 2000); // Wait for page to fully load
        };
        
        // Fallback: try after 5 seconds even if onload doesn't fire
        setTimeout(() => {
            if (loading.style.display !== 'none') {
                scrollToElement();
            }
        }, 5000);
    </script>
</body>
</html>`;
    
    res.send(viewerHtml);
});

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Helper function to extract URL pairs from Excel sheet (Column A = left, Column B = right)
function extractUrlPairsFromExcel(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const urlPairs = [];
        
        // Process first sheet (or all sheets if needed)
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        // Extract URLs from Column A (index 0) and Column B (index 1)
        data.forEach((row, rowIndex) => {
            const leftCell = row[0] || '';
            const rightCell = row[1] || '';
            
            // Extract URL from left cell (Column A)
            let leftUrl = null;
            if (leftCell && typeof leftCell === 'string') {
                const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
                const leftMatch = leftCell.match(urlRegex);
                if (leftMatch && leftMatch.length > 0) {
                    try {
                        leftUrl = new URL(leftMatch[0]).href;
                    } catch (e) {
                        // Invalid URL, skip
                    }
                }
            }
            
            // Extract URL from right cell (Column B)
            let rightUrl = null;
            if (rightCell && typeof rightCell === 'string') {
                const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
                const rightMatch = rightCell.match(urlRegex);
                if (rightMatch && rightMatch.length > 0) {
                    try {
                        rightUrl = new URL(rightMatch[0]).href;
                    } catch (e) {
                        // Invalid URL, skip
                    }
                }
            }
            
            // Only add if at least one URL exists
            if (leftUrl || rightUrl) {
                urlPairs.push({
                    row: rowIndex + 1,
                    leftUrl: leftUrl,
                    rightUrl: rightUrl,
                    leftContext: typeof leftCell === 'string' ? leftCell.substring(0, 100) : '',
                    rightContext: typeof rightCell === 'string' ? rightCell.substring(0, 100) : '',
                    sheet: sheetName
                });
            }
        });
        
        return urlPairs;
    } catch (error) {
        throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
}

// Endpoint to compare Excel file with URL pairs and perform DOM comparison
app.post('/api/compare-excel', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Excel file is required' });
        }

        const excelFile = req.file;

        // Extract URL pairs from Excel (Column A = left, Column B = right)
        const urlPairs = extractUrlPairsFromExcel(excelFile.buffer);

        if (urlPairs.length === 0) {
            return res.status(400).json({ error: 'No URLs found in the Excel file. Please ensure Column A contains left URLs and Column B contains right URLs.' });
        }

        // Set up Server-Sent Events for streaming results
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send initial status
        res.write(`data: ${JSON.stringify({ type: 'start', total: urlPairs.length })}\n\n`);

        // Process URL pairs in parallel batches
        const batchSize = 5; // Process 5 URLs at a time
        const results = [];
        let processed = 0;
        let hasChanges = 0;

        for (let i = 0; i < urlPairs.length; i += batchSize) {
            const batch = urlPairs.slice(i, i + batchSize);
            
            // Process batch in parallel
            const batchPromises = batch.map(async (pair) => {
                try {
                    // Determine initial status
                    let status = 'match';
                    if (pair.leftUrl && !pair.rightUrl) {
                        status = 'only-left';
                    } else if (!pair.leftUrl && pair.rightUrl) {
                        status = 'only-right';
                    } else if (pair.leftUrl && pair.rightUrl && pair.leftUrl !== pair.rightUrl) {
                        status = 'different';
                    }

                    // If both URLs exist and are different, perform DOM comparison
                    let domComparison = null;
                    let hasDomChanges = false;
                    
                    if (pair.leftUrl && pair.rightUrl && pair.leftUrl !== pair.rightUrl) {
                        try {
                            domComparison = await compareTwoUrls(pair.leftUrl, pair.rightUrl);
                            if (domComparison && domComparison.summary) {
                                // Check if there are actual differences (body content or meta tags)
                                hasDomChanges = domComparison.summary.only1 > 0 || 
                                               domComparison.summary.only2 > 0 || 
                                               domComparison.summary.different > 0 ||
                                               domComparison.summary.similarity < 100 ||
                                               (domComparison.summary.metaDifferences && domComparison.summary.metaDifferences > 0);
                            }
                        } catch (domError) {
                            // Skip DOM comparison error, continue with URL comparison
                            console.warn(`DOM comparison failed for row ${pair.row}:`, domError.message);
                            domComparison = { error: domError.message };
                        }
                    }

                    const result = {
                        row: pair.row,
                        leftUrl: pair.leftUrl,
                        rightUrl: pair.rightUrl,
                        status: status,
                        hasDomChanges: hasDomChanges,
                        domComparison: domComparison,
                        leftInfo: pair.leftUrl ? {
                            url: pair.leftUrl,
                            sheet: pair.sheet,
                            row: pair.row,
                            col: 1,
                            context: pair.leftContext
                        } : null,
                        rightInfo: pair.rightUrl ? {
                            url: pair.rightUrl,
                            sheet: pair.sheet,
                            row: pair.row,
                            col: 2,
                            context: pair.rightContext
                        } : null
                    };

                    if (hasDomChanges || status !== 'match') {
                        hasChanges++;
                    }

                    processed++;
                    
                    // Send result immediately if it has changes
                    if (hasDomChanges || status !== 'match') {
                        res.write(`data: ${JSON.stringify({ type: 'result', data: result, processed, total: urlPairs.length, hasChanges })}\n\n`);
                    }

                    return result;
                } catch (error) {
                    // Skip errors, continue processing
                    console.warn(`Error processing row ${pair.row}:`, error.message);
                    processed++;
                    return {
                        row: pair.row,
                        leftUrl: pair.leftUrl,
                        rightUrl: pair.rightUrl,
                        status: 'error',
                        error: error.message,
                        leftInfo: pair.leftUrl ? {
                            url: pair.leftUrl,
                            sheet: pair.sheet,
                            row: pair.row,
                            col: 1
                        } : null,
                        rightInfo: pair.rightUrl ? {
                            url: pair.rightUrl,
                            sheet: pair.sheet,
                            row: pair.row,
                            col: 2
                        } : null
                    };
                }
            });

            await Promise.all(batchPromises).then(batchResults => {
                results.push(...batchResults);
            });
        }

        // Calculate final statistics
        const stats = {
            total: results.length,
            matches: results.filter(c => c.status === 'match' && c.leftUrl && c.rightUrl && !c.hasDomChanges).length,
            different: results.filter(c => c.status === 'different' || c.hasDomChanges).length,
            onlyLeft: results.filter(c => c.status === 'only-left').length,
            onlyRight: results.filter(c => c.status === 'only-right').length,
            errors: results.filter(c => c.status === 'error').length,
            changes: results.filter(c => c.status !== 'match' || c.hasDomChanges).length
        };

        // Send final summary
        res.write(`data: ${JSON.stringify({ type: 'complete', stats, results, processed, hasChanges })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Excel comparison error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

// Helper function to compare two URLs
async function compareTwoUrls(url1, url2) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
        throw new Error('Failed to launch browser');
    }

    try {
        // Extract both pages in parallel
        const [r1, r2] = await Promise.all([
            extractPageContent(browser, url1).catch(err => ({ success: false, url: url1, error: err.message })),
            extractPageContent(browser, url2).catch(err => ({ success: false, url: url2, error: err.message }))
        ]);

        if (!r1.success || !r2.success) {
            await browser.close();
            throw new Error(`Page load failed: ${r1.success ? '' : url1 + ' '}${r2.success ? '' : url2}`);
        }

        const { comparison, summary } = buildComparison(r1.lines, r2.lines, r1.meta || {}, r2.meta || {});
        await browser.close();
        
        return {
            url1, url2,
            comparison,
            summary,
            meta1: r1.meta || { title: '', description: '' },
            meta2: r2.meta || { title: '', description: '' }
        };
    } catch (err) {
        try { await browser.close(); } catch (_) {}
        throw err;
    }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const server = app.listen(PORT, () => {
    console.log(`🚀 DOM Comparison Tool running on http://localhost:${PORT}`);
    console.log(`📊 POST /api/compare with JSON { "url1":"...", "url2":"..." }`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use!`);
        console.error(`💡 Run: npm run kill-port (or ./kill-port.sh)`);
        console.error(`💡 Or run: npm run fresh-start (kills port and starts server)\n`);
        process.exit(1);
    } else {
        throw err;
    }
});