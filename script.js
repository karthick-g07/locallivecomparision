document.addEventListener('DOMContentLoaded', function() {
    // URL Comparison elements
    const liveUrlInput = document.getElementById('liveUrl');
    const testUrlInput = document.getElementById('testUrl');
    const compareBtn = document.getElementById('compareBtn');
    const clearBtn = document.getElementById('clearBtn');
    const loading = document.getElementById('loading');
    const resultsContainer = document.getElementById('resultsContainer');
    const errorMessage = document.getElementById('errorMessage');
    const liveResults = document.getElementById('liveResults');
    const testResults = document.getElementById('testResults');
    const filterButtons = document.getElementById('filterButtons');
    const nodeModal = document.getElementById('nodeModal');
    const modalClose = document.getElementById('modalClose');
    const modalBody = document.getElementById('modalBody');
    const modalLoading = document.getElementById('modalLoading');
    
    // Excel Comparison elements
    const excelFile = document.getElementById('excelFile');
    const excelUploadArea = document.getElementById('excelUploadArea');
    const excelFileName = document.getElementById('excelFileName');
    const compareExcelBtn = document.getElementById('compareExcelBtn');
    const clearExcelBtn = document.getElementById('clearExcelBtn');
    const excelLoading = document.getElementById('excelLoading');
    const excelErrorMessage = document.getElementById('excelErrorMessage');
    const excelDashboard = document.getElementById('excelDashboard');
    const changesList = document.getElementById('changesList');
    
    // Tab navigation
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Tab switching functionality
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.dataset.tab;
            
            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            
            // Hide all tab contents
            tabContents.forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none';
            });
            
            // Add active class to clicked button
            this.classList.add('active');
            
            // Show corresponding tab content
            const targetContent = document.getElementById(targetTab + '-tab');
            if (targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = 'block';
            }
        });
    });
    
    // Initialize: Hide Excel tab by default
    const excelTab = document.getElementById('excel-compare-tab');
    if (excelTab) {
        excelTab.style.display = 'none';
    }
    
    // Summary elements
    const totalLines = document.getElementById('totalLines');
    const matchingLines = document.getElementById('matchingLines');
    const differentLines = document.getElementById('differentLines');
    const uniqueLive = document.getElementById('uniqueLive');
    const uniqueTest = document.getElementById('uniqueTest');
    const similarity = document.getElementById('similarity');

    // Store comparison data globally
    let comparisonData = null;
    let currentFilter = 'all';
    let currentUrls = { url1: '', url2: '' };

    // Event listener for compare button
    compareBtn.addEventListener('click', async function() {
        const url1 = liveUrlInput.value.trim();
        const url2 = testUrlInput.value.trim();
        
        if (!url1 || !url2) {
            showError('Please enter both URLs');
            return;
        }

        // Validate URLs
        try {
            new URL(url1);
            new URL(url2);
        } catch (e) {
            showError('Please enter valid URLs');
            return;
        }

        // Show loading state
        compareBtn.disabled = true;
        compareBtn.textContent = 'Comparing...';
        loading.style.display = 'block';
        resultsContainer.style.display = 'none';
        hideError();

        try {
            // Call the backend API
            const response = await fetch('/api/compare', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url1: url1,
                    url2: url2
                })
            });

            const data = await response.json();

            if (!response.ok) {
                // Build detailed error message
                let errorMsg = data.error || 'Comparison failed';
                
                // Handle string details (new format)
                if (data.details && typeof data.details === 'string') {
                    errorMsg += '\n\n' + data.details;
                }
                // Handle object details (old format for backward compatibility)
                else if (data.details && typeof data.details === 'object') {
                    const details = [];
                    if (data.details.url1) {
                        details.push(`Live URL: ${data.details.url1}`);
                    }
                    if (data.details.url2) {
                        details.push(`Test URL: ${data.details.url2}`);
                    }
                    if (details.length > 0) {
                        errorMsg += '\n\n' + details.join('\n');
                    }
                }
                // Also check urlErrors for additional details
                if (data.urlErrors) {
                    const urlErrors = [];
                    if (data.urlErrors.url1) {
                        urlErrors.push(`Live URL error: ${data.urlErrors.url1}`);
                    }
                    if (data.urlErrors.url2) {
                        urlErrors.push(`Test URL error: ${data.urlErrors.url2}`);
                    }
                    if (urlErrors.length > 0 && !errorMsg.includes(urlErrors[0])) {
                        errorMsg += '\n\n' + urlErrors.join('\n');
                    }
                }
                
                throw new Error(errorMsg);
            }

            // Store comparison data
            comparisonData = data;
            currentUrls = { url1: data.url1, url2: data.url2 };
            currentFilter = 'all';

            // Display results
            displayComparison(data);
            
        } catch (error) {
            showError(`Comparison failed: ${error.message}`);
        } finally {
            // Reset loading state
            compareBtn.disabled = false;
            compareBtn.textContent = 'Compare DOM';
            loading.style.display = 'none';
        }
    });

    // Event listener for clear button
    clearBtn.addEventListener('click', function() {
        liveUrlInput.value = 'https://www.zoho.com/in/payroll/';
        testUrlInput.value = 'https://www.localzoho.com/en-sa/payroll/';
        liveResults.innerHTML = '';
        testResults.innerHTML = '';
        resultsContainer.style.display = 'none';
        if (filterButtons) filterButtons.style.display = 'none';
        comparisonData = null;
        currentFilter = 'all';
        // Reset filter buttons
        if (filterButtons) {
            filterButtons.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            const allBtn = filterButtons.querySelector('[data-filter="all"]');
            if (allBtn) allBtn.classList.add('active');
        }
        hideError();
    });

    // Filter button event listeners
    filterButtons.addEventListener('click', function(e) {
        if (e.target.classList.contains('filter-btn')) {
            // Update active state
            filterButtons.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            e.target.classList.add('active');
            
            // Update filter
            currentFilter = e.target.dataset.filter;
            
            // Re-render with filter
            if (comparisonData) {
                displayComparison(comparisonData);
            }
        }
    });

    // Modal close handlers
    modalClose.addEventListener('click', closeModal);
    nodeModal.addEventListener('click', function(e) {
        if (e.target === nodeModal) {
            closeModal();
        }
    });

    // Function to display comparison results
    function displayComparison(data) {
        // Clear previous results
        liveResults.innerHTML = '';
        testResults.innerHTML = '';

        // Filter comparison items based on current filter
        let filteredItems = data.comparison;
        if (currentFilter !== 'all') {
            filteredItems = data.comparison.filter(item => {
                if (currentFilter === 'match') return item.status === 'match';
                if (currentFilter === 'only1') return item.status === 'only1';
                if (currentFilter === 'only2') return item.status === 'only2';
                return true;
            });
        }

        // Display comparison lines
        filteredItems.forEach(item => {
            const liveLine = createLineElement(item.line1, item.status, 'live', item.index, data.url1);
            const testLine = createLineElement(item.line2, item.status, 'test', item.index, data.url2);
            
            liveResults.appendChild(liveLine);
            testResults.appendChild(testLine);
        });

        // Update summary
        if (data.summary) {
            totalLines.textContent = data.summary.total;
            matchingLines.textContent = data.summary.match;
            differentLines.textContent = data.summary.different;
            uniqueLive.textContent = data.summary.only1;
            uniqueTest.textContent = data.summary.only2;
            similarity.textContent = `${data.summary.similarity}%`;
        }

        // Display meta tags comparison
        displayMetaComparison(data);

        // Show results container and filter buttons
        resultsContainer.style.display = 'block';
        filterButtons.style.display = 'flex';
    }
    
    // Function to display meta tags comparison
    function displayMetaComparison(data) {
        const metaComparison = document.getElementById('metaComparison');
        const metaTitleLive = document.getElementById('metaTitleLiveValue');
        const metaTitleTest = document.getElementById('metaTitleTestValue');
        const metaDescLive = document.getElementById('metaDescLiveValue');
        const metaDescTest = document.getElementById('metaDescTestValue');
        const metaTitleLiveDiv = document.getElementById('metaTitleLive');
        const metaTitleTestDiv = document.getElementById('metaTitleTest');
        const metaDescLiveDiv = document.getElementById('metaDescLive');
        const metaDescTestDiv = document.getElementById('metaDescTest');
        
        if (!data.meta1 || !data.meta2) {
            if (metaComparison) metaComparison.style.display = 'none';
            return;
        }
        
        // Show meta comparison section
        if (metaComparison) metaComparison.style.display = 'block';
        
        // Display title comparison
        const title1 = data.meta1.title || '';
        const title2 = data.meta2.title || '';
        if (metaTitleLive) metaTitleLive.textContent = title1 || '(empty)';
        if (metaTitleTest) metaTitleTest.textContent = title2 || '(empty)';
        
        // Display description comparison
        const desc1 = data.meta1.description || '';
        const desc2 = data.meta2.description || '';
        if (metaDescLive) metaDescLive.textContent = desc1 || '(empty)';
        if (metaDescTest) metaDescTest.textContent = desc2 || '(empty)';
        
        // Apply styling based on comparison status
        if (data.summary && data.summary.metaComparison) {
            const titleStatus = data.summary.metaComparison.title.status;
            const descStatus = data.summary.metaComparison.description.status;
            
            // Update title styling
            if (metaTitleLiveDiv) {
                metaTitleLiveDiv.className = `meta-value live-meta ${titleStatus === 'only1' || titleStatus === 'different' ? 'has-difference' : ''}`;
            }
            if (metaTitleTestDiv) {
                metaTitleTestDiv.className = `meta-value test-meta ${titleStatus === 'only2' || titleStatus === 'different' ? 'has-difference' : ''}`;
            }
            
            // Update description styling
            if (metaDescLiveDiv) {
                metaDescLiveDiv.className = `meta-value live-meta ${descStatus === 'only1' || descStatus === 'different' ? 'has-difference' : ''}`;
            }
            if (metaDescTestDiv) {
                metaDescTestDiv.className = `meta-value test-meta ${descStatus === 'only2' || descStatus === 'different' ? 'has-difference' : ''}`;
            }
        }
    }

    // Function to create line element
    function createLineElement(text, status, side, index, url) {
        const lineDiv = document.createElement('div');
        
        if (!text) {
            lineDiv.className = 'text-line empty-line';
            lineDiv.innerHTML = `<span class="line-number">${index + 1}</span>---`;
            return lineDiv;
        }

        lineDiv.className = `text-line ${status} clickable`;
        lineDiv.dataset.text = text;
        lineDiv.dataset.side = side;
        lineDiv.dataset.index = index;
        
        // Truncate very long lines for display
        const displayText = text.length > 200 ? text.substring(0, 200) + '...' : text;
        
        const lineContent = document.createElement('div');
        lineContent.style.display = 'flex';
        lineContent.style.alignItems = 'center';
        lineContent.style.gap = '10px';
        
        const lineNumber = document.createElement('span');
        lineNumber.className = 'line-number';
        lineNumber.textContent = index + 1;
        
        const lineText = document.createElement('span');
        lineText.className = 'line-text';
        lineText.textContent = displayText;
        lineText.style.flex = '1';
        
        lineContent.appendChild(lineNumber);
        lineContent.appendChild(lineText);
        
        // Always show View More button for all lines
        const btn = document.createElement('button');
        btn.className = 'view-more-btn';
        btn.textContent = 'View More';
        btn.dataset.text = text;
        btn.dataset.side = side;
        btn.dataset.url = url;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            showNodeDetails(text, side, url);
        });
        lineContent.appendChild(btn);
        
        lineDiv.appendChild(lineContent);
        
        // Add click handler for the line
        lineDiv.addEventListener('click', function(e) {
            if (!e.target.classList.contains('view-more-btn') && !e.target.closest('.view-more-btn')) {
                showNodeDetails(text, side, url);
            }
        });
        
        return lineDiv;
    }

    // Function to show node details in modal
    async function showNodeDetails(text, side, url) {
        nodeModal.style.display = 'flex';
        modalBody.innerHTML = '';
        modalLoading.style.display = 'block';

        try {
            console.log('Fetching node details for:', { text: text.substring(0, 50), side, url });
            
            const response = await fetch('/api/node-details', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: url,
                    text: text,
                    side: side
                })
            });

            const data = await response.json();
            console.log('Node details response:', { success: response.ok, hasScreenshot: !!data.screenshot, hasNodeInfo: !!data.nodeInfo });

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load node details');
            }

            modalLoading.style.display = 'none';
            
            // Display node details
            const nodeInfo = data.nodeInfo;
            
            // Check if screenshot exists
            let screenshotHtml;
            if (data.screenshot && data.screenshot.length > 0) {
                screenshotHtml = `<div class="screenshot-container">
                    <img src="data:image/png;base64,${data.screenshot}" 
                         alt="Node screenshot" 
                         class="node-screenshot"
                         onload="console.log('Screenshot loaded successfully')"
                         onerror="console.error('Screenshot failed to load'); this.parentElement.innerHTML='<p style=\\'color:red; padding:20px;\\'>Failed to load screenshot. The element may be outside the viewport or too small.</p>'">
                </div>`;
            } else {
                screenshotHtml = `<div class="screenshot-container">
                    <p style="color: #7f8c8d; padding: 20px; text-align: center;">
                        Screenshot not available. The element may be outside the viewport, hidden, or too small to capture.
                    </p>
                </div>`;
            }
            
            modalBody.innerHTML = `
                <div class="node-details">
                    <div class="detail-section">
                        <h3>Text Content</h3>
                        <div class="detail-value">${escapeHtml(data.text)}</div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Screenshot</h3>
                        ${screenshotHtml}
                    </div>
                    
                    <div class="detail-section">
                        <h3>Element Information</h3>
                        <div class="info-grid">
                            <div class="info-item">
                                <strong>Tag:</strong> <code>${escapeHtml(nodeInfo.tagName)}</code>
                            </div>
                            <div class="info-item">
                                <strong>ID:</strong> <code>${escapeHtml(nodeInfo.id || 'N/A')}</code>
                            </div>
                            <div class="info-item">
                                <strong>Class:</strong> <code>${escapeHtml(nodeInfo.className || 'N/A')}</code>
                            </div>
                            <div class="info-item">
                                <strong>XPath:</strong> <code class="xpath">${escapeHtml(nodeInfo.xpath)}</code>
                            </div>
                        </div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Position & Size</h3>
                        <div class="info-grid">
                            <div class="info-item">
                                <strong>X:</strong> ${nodeInfo.rect.x}px
                            </div>
                            <div class="info-item">
                                <strong>Y:</strong> ${nodeInfo.rect.y}px
                            </div>
                            <div class="info-item">
                                <strong>Width:</strong> ${nodeInfo.rect.width}px
                            </div>
                            <div class="info-item">
                                <strong>Height:</strong> ${nodeInfo.rect.height}px
                            </div>
                        </div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Styles</h3>
                        <div class="info-grid">
                            <div class="info-item">
                                <strong>Background:</strong> <span class="color-box" style="background-color: ${nodeInfo.styles.backgroundColor}"></span> ${nodeInfo.styles.backgroundColor}
                            </div>
                            <div class="info-item">
                                <strong>Color:</strong> <span class="color-box" style="background-color: ${nodeInfo.styles.color}"></span> ${nodeInfo.styles.color}
                            </div>
                            <div class="info-item">
                                <strong>Font Size:</strong> ${nodeInfo.styles.fontSize}
                            </div>
                            <div class="info-item">
                                <strong>Font Family:</strong> ${nodeInfo.styles.fontFamily}
                            </div>
                        </div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Full Text Content</h3>
                        <div class="detail-value full-text">${escapeHtml(nodeInfo.fullText || data.text)}</div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Source URL</h3>
                        <div class="detail-value">
                            <a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a>
                        </div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>View on Page</h3>
                        <div class="view-on-page-container">
                            ${generateViewOnPageLink(url, nodeInfo, data.text)}
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading node details:', error);
            modalLoading.style.display = 'none';
            modalBody.innerHTML = `
                <div class="error-message">
                    <strong>Error loading node details:</strong><br>
                    ${escapeHtml(error.message)}<br><br>
                    <small>This might happen if the element is not found on the page or the page structure has changed.</small>
                </div>
            `;
        }
    }

    // Function to close modal
    function closeModal() {
        nodeModal.style.display = 'none';
        modalBody.innerHTML = '';
    }

    // Helper function to generate "View on Page" link
    function generateViewOnPageLink(url, nodeInfo, text) {
        const params = new URLSearchParams();
        params.append('url', url);
        
        if (nodeInfo.xpath) {
            params.append('xpath', nodeInfo.xpath);
        }
        if (nodeInfo.id && nodeInfo.id !== 'N/A') {
            params.append('id', nodeInfo.id);
        }
        if (text) {
            params.append('text', text.substring(0, 200)); // Limit text length
        }
        
        const viewUrl = `/view?${params.toString()}`;
        
        // If element has an ID, also provide direct link with hash
        let directLink = '';
        if (nodeInfo.id && nodeInfo.id !== 'N/A') {
            const directUrl = url + (url.includes('#') ? '' : '#') + nodeInfo.id;
            directLink = `
                <a href="${escapeHtml(directUrl)}" target="_blank" class="view-on-page-btn direct-link" style="background-color: #2ecc71; margin-left: 10px;">
                    🔗 Direct Link (ID)
                </a>
            `;
        }
        
        return `
            <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center;">
                <a href="${viewUrl}" target="_blank" class="view-on-page-btn">
                    🔍 View on Page & Scroll to Element
                </a>
                ${directLink}
            </div>
            <p style="margin-top: 10px; font-size: 12px; color: #7f8c8d; text-align: center;">
                Opens the page and automatically scrolls to this element. If iframe is blocked, use the direct link.
            </p>
        `;
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Function to show error message
    function showError(message) {
        // Replace newlines with line breaks for better display
        errorMessage.innerHTML = message.split('\n').map(line => {
            if (line.includes(':')) {
                const parts = line.split(':');
                return `<strong>${parts[0]}:</strong>${parts.slice(1).join(':')}`;
            }
            return line;
        }).join('<br>');
        errorMessage.style.display = 'block';
        // Scroll to error message
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Function to hide error message
    function hideError() {
        errorMessage.style.display = 'none';
    }
    
    // ========== EXCEL FILE UPLOAD ==========
    excelUploadArea.addEventListener('click', () => excelFile.click());
    
    excelFile.addEventListener('change', function(e) {
        if (e.target.files.length > 0) {
            excelFileName.textContent = e.target.files[0].name;
            excelUploadArea.classList.add('has-file');
            compareExcelBtn.disabled = false;
        } else {
            compareExcelBtn.disabled = true;
        }
    });
    
    // ========== EXCEL COMPARISON ==========
    let excelResults = [];
    let excelStats = null;
    let currentExcelFilter = 'all';
    
    compareExcelBtn.addEventListener('click', async function() {
        const formData = new FormData();
        formData.append('excelFile', excelFile.files[0]);
        
        compareExcelBtn.disabled = true;
        compareExcelBtn.textContent = 'Comparing...';
        excelLoading.style.display = 'block';
        excelDashboard.style.display = 'block';
        excelErrorMessage.style.display = 'none';
        
        // Clear previous results
        excelResults = [];
        excelStats = null;
        changesList.innerHTML = '<div class="processing-status">Processing URLs in parallel... <span id="progressText">0/0</span></div>';
        
        // Disable filter buttons during processing
        document.getElementById('filterAllBtn').disabled = true;
        document.getElementById('filterChangesBtn').disabled = true;
        
        try {
            const response = await fetch('/api/compare-excel', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Failed to start comparison');
            }

            // Handle Server-Sent Events
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            
                            if (data.type === 'start') {
                                updateProgress(0, data.total);
                            } else if (data.type === 'result') {
                                // Add result immediately if it has changes
                                excelResults.push(data.data);
                                addChangeCard(data.data);
                                updateProgress(data.processed, data.total);
                            } else if (data.type === 'complete') {
                                excelStats = data.stats;
                                excelResults = data.results;
                                updateDashboardStats(data.stats);
                                updateProgress(data.processed, data.total);
                                compareExcelBtn.disabled = false;
                                compareExcelBtn.textContent = 'Compare URLs';
                                excelLoading.style.display = 'none';
                                
                                // Enable filter buttons after completion
                                const filterAllBtn = document.getElementById('filterAllBtn');
                                const filterChangesBtn = document.getElementById('filterChangesBtn');
                                if (filterAllBtn) filterAllBtn.disabled = false;
                                if (filterChangesBtn) filterChangesBtn.disabled = false;
                                
                                // Re-render with current filter
                                renderChangesList();
                                document.getElementById('filterAllBtn').disabled = false;
                                document.getElementById('filterChangesBtn').disabled = false;
                                
                                // Re-render with current filter
                                renderChangesList();
                            } else if (data.type === 'error') {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            console.error('Error parsing SSE data:', parseError);
                        }
                    }
                }
            }
            
        } catch (error) {
            excelErrorMessage.textContent = `Error: ${error.message}`;
            excelErrorMessage.style.display = 'block';
            compareExcelBtn.disabled = false;
            compareExcelBtn.textContent = 'Compare URLs';
            excelLoading.style.display = 'none';
        }
    });
    
    function updateProgress(processed, total) {
        const progressText = document.getElementById('progressText');
        if (progressText) {
            progressText.textContent = `${processed}/${total}`;
        }
    }
    
    function addChangeCard(item) {
        // Only add if it has changes (for real-time display during processing)
        // During processing, we always show only changes to avoid clutter
        const isPureMatch = item.status === 'match' && 
                           item.hasDomChanges !== true && 
                           item.leftUrl && 
                           item.rightUrl &&
                           item.leftUrl === item.rightUrl &&
                           item.status !== 'error';
        
        // Skip pure matches during processing
        if (isPureMatch) {
            return;
        }
        
        const hasChanges = item.status === 'different' || 
                          item.hasDomChanges === true || 
                          item.status === 'only-left' ||
                          item.status === 'only-right' ||
                          item.status === 'error' ||
                          (item.leftUrl && item.rightUrl && item.leftUrl !== item.rightUrl);
        
        if (!hasChanges) {
            return; // Skip unchanged items
        }
        
        const changeCard = createChangeCard(item);
        changesList.appendChild(changeCard);
    }
    
    function createChangeCard(item) {
        const changeCard = document.createElement('div');
        changeCard.className = `change-card ${item.status}`;
        
        const statusIcon = item.status === 'match' ? '✅' : 
                          item.status === 'only-left' ? '⬅️' : 
                          item.status === 'only-right' ? '➡️' : 
                          item.status === 'different' ? '⚠️' : 
                          item.status === 'error' ? '❌' : '❓';
        
        const statusText = item.status === 'match' ? (item.hasDomChanges ? 'DOM CHANGES' : 'MATCH - NEEDS CHECK') :
                          item.status === 'only-left' ? 'ONLY LEFT' :
                          item.status === 'only-right' ? 'ONLY RIGHT' :
                          item.status === 'different' ? 'DIFFERENT' : 
                          item.status === 'error' ? 'ERROR' : 'UNKNOWN';
        
        const hasBothUrls = item.leftUrl && item.rightUrl;
        // Can compare if both URLs exist (even if match, might need DOM check)
        const canCompare = hasBothUrls;
        const domInfo = item.domComparison && item.domComparison.summary ? 
            `<div class="dom-info">
                <strong>DOM Similarity:</strong> ${item.domComparison.summary.similarity}% | 
                <strong>Changes:</strong> ${item.domComparison.summary.only1 + item.domComparison.summary.only2} lines
            </div>` : '';
        
        // Meta tags info
        let metaInfo = '';
        if (item.domComparison && item.domComparison.summary && item.domComparison.summary.metaComparison) {
            const metaComp = item.domComparison.summary.metaComparison;
            const metaDiffs = [];
            if (!metaComp.title.match) {
                metaDiffs.push(`Title: ${metaComp.title.status}`);
            }
            if (!metaComp.description.match) {
                metaDiffs.push(`Description: ${metaComp.description.status}`);
            }
            if (metaDiffs.length > 0) {
                metaInfo = `<div class="meta-info">
                    <strong>Meta Differences:</strong> ${metaDiffs.join(' | ')}
                </div>`;
            }
        }
        
        // Button text based on status
        const buttonText = item.status === 'match' && !item.hasDomChanges ? 'Check DOM' : 'View Details';
        
        changeCard.innerHTML = `
            <div class="change-card-header">
                <span class="status-badge ${item.status}">${statusIcon} ${statusText}</span>
                ${canCompare ? `
                    <button class="compare-url-btn" data-left-url="${escapeHtml(item.leftUrl)}" data-right-url="${escapeHtml(item.rightUrl)}" data-row="${item.row}" data-has-dom="${item.hasDomChanges}">
                        ${buttonText}
                    </button>
                ` : ''}
            </div>
            <div class="change-card-body">
                <div class="row-info">
                    <strong>Row ${item.row}</strong> in ${item.leftInfo?.sheet || item.rightInfo?.sheet || 'Sheet'}
                </div>
                ${item.leftUrl ? `
                    <div class="url-display left-url">
                        <strong>Left URL (Column A):</strong> 
                        <a href="${escapeHtml(item.leftUrl)}" target="_blank" class="url-link">${escapeHtml(item.leftUrl)}</a>
                    </div>
                ` : '<div class="url-display left-url missing">No URL in Column A</div>'}
                ${item.rightUrl ? `
                    <div class="url-display right-url">
                        <strong>Right URL (Column B):</strong> 
                        <a href="${escapeHtml(item.rightUrl)}" target="_blank" class="url-link">${escapeHtml(item.rightUrl)}</a>
                    </div>
                ` : '<div class="url-display right-url missing">No URL in Column B</div>'}
                ${domInfo}
                ${metaInfo}
                ${item.error ? `<div class="error-info">Error: ${escapeHtml(item.error)}</div>` : ''}
            </div>
        `;
        
        // Add click handler for compare button
        if (canCompare) {
            const compareUrlBtn = changeCard.querySelector('.compare-url-btn');
            compareUrlBtn.addEventListener('click', function() {
                const leftUrl = this.dataset.leftUrl;
                const rightUrl = this.dataset.rightUrl;
                const row = this.dataset.row;
                const hasDom = this.dataset.hasDom === 'true';
                
                // Store DOM comparison data if available
                const itemData = excelResults.find(r => r.row == row);
                if (itemData && itemData.domComparison) {
                    // Switch to URL comparison tab
                    document.querySelector('[data-tab="url-compare"]').click();
                    
                    // Set URLs
                    liveUrlInput.value = leftUrl;
                    testUrlInput.value = rightUrl;
                    
                    // Display the stored comparison data
                    setTimeout(() => {
                        displayComparison(itemData.domComparison);
                    }, 300);
                } else {
                    // If no DOM data, trigger new comparison
                    document.querySelector('[data-tab="url-compare"]').click();
                    liveUrlInput.value = leftUrl;
                    testUrlInput.value = rightUrl;
                    setTimeout(() => {
                        compareBtn.click();
                    }, 500);
                }
            });
        }
        
        return changeCard;
    }
    
    function updateDashboardStats(stats) {
        if (!stats) return;
        document.getElementById('excelTotalUrls').textContent = stats.total;
        document.getElementById('excelMatches').textContent = stats.matches;
        document.getElementById('excelOnlyLeft').textContent = stats.onlyLeft;
        document.getElementById('excelOnlyRight').textContent = stats.onlyRight;
        document.getElementById('excelChanges').textContent = stats.changes || stats.different || 0;
    }
    
    clearExcelBtn.addEventListener('click', function() {
        excelFile.value = '';
        excelFileName.textContent = 'No file selected';
        excelUploadArea.classList.remove('has-file');
        excelDashboard.style.display = 'none';
        excelErrorMessage.style.display = 'none';
        compareExcelBtn.disabled = true;
        excelResults = [];
        excelStats = null;
        changesList.innerHTML = '';
        
        // Disable filter buttons
        const filterAllBtn = document.getElementById('filterAllBtn');
        const filterChangesBtn = document.getElementById('filterChangesBtn');
        if (filterAllBtn) filterAllBtn.disabled = true;
        if (filterChangesBtn) filterChangesBtn.disabled = true;
    });
    
    // ========== EXCEL DASHBOARD FILTERS ==========
    // Use event delegation for filter buttons (works even if buttons are added dynamically)
    document.addEventListener('click', function(e) {
        const filterBtn = e.target.closest('.dashboard-filter-btn');
        if (filterBtn && !filterBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            
            const allFilters = document.querySelectorAll('.dashboard-filter-btn');
            allFilters.forEach(b => b.classList.remove('active'));
            filterBtn.classList.add('active');
            currentExcelFilter = filterBtn.dataset.filter || 'all';
            
            renderChangesList();
        }
    });
    
    function renderChangesList() {
        console.log('=== RENDER CHANGES LIST CALLED ===');
        console.log('currentExcelFilter:', currentExcelFilter);
        console.log('excelResults:', excelResults ? excelResults.length : 'null/undefined');
        
        if (!excelResults || excelResults.length === 0) {
            console.log('No results to display');
            changesList.innerHTML = '<p style="text-align: center; padding: 40px; color: #7f8c8d;">No items found</p>';
            return;
        }
        
        let filtered = [];
        
        if (currentExcelFilter === 'changes') {
            console.log('=== APPLYING CHANGES ONLY FILTER ===');
            console.log('Total items before filter:', excelResults.length);
            
            // Show only items with actual changes - remove all unchanged
            // SIMPLIFIED AND BULLETPROOF LOGIC
            filtered = excelResults.filter((item, index) => {
                // DEBUG: Log every item being checked
                const debug = {
                    row: item.row,
                    status: item.status,
                    hasDomChanges: item.hasDomChanges,
                    leftUrlExists: !!item.leftUrl,
                    rightUrlExists: !!item.rightUrl,
                    urlsEqual: item.leftUrl && item.rightUrl ? item.leftUrl === item.rightUrl : false
                };
                console.log(`[DEBUG] Item ${index + 1} (Row ${item.row}):`, debug);
                
                // ITEM IS UNCHANGED IF:
                // - status === 'match' AND
                // - hasDomChanges !== true AND  
                // - Both URLs exist AND
                // - URLs are the same
                const isUnchanged = (
                    item.status === 'match' &&
                    item.hasDomChanges !== true &&
                    item.leftUrl &&
                    item.rightUrl &&
                    item.leftUrl === item.rightUrl
                );
                
                // ITEM HAS CHANGES IF:
                // - status is 'different', 'only-left', 'only-right', or 'error' OR
                // - hasDomChanges is true OR
                // - URLs are different OR
                // - NOT unchanged
                const hasChanges = item.status === 'different' ||
                                  item.status === 'only-left' ||
                                  item.status === 'only-right' ||
                                  item.status === 'error' ||
                                  item.hasDomChanges === true ||
                                  (item.leftUrl && item.rightUrl && item.leftUrl !== item.rightUrl) ||
                                  !isUnchanged;
                
                if (isUnchanged) {
                    console.log(`  ❌ EXCLUDED - Row ${item.row} is UNCHANGED (match, no DOM changes, same URLs)`);
                    return false;
                } else {
                    console.log(`  ✅ INCLUDED - Row ${item.row} has CHANGES (status: ${item.status}, hasDomChanges: ${item.hasDomChanges})`);
                    return true;
                }
            });
            
            console.log('\n=== FILTER RESULTS ===');
            console.log('Items before filter:', excelResults.length);
            console.log('Items after filter (changes only):', filtered.length);
            console.log('Items removed (unchanged):', excelResults.length - filtered.length);
        } else {
            console.log('=== SHOWING ALL ITEMS ===');
            // Show all items (including matches that may need DOM check)
            filtered = excelResults;
            console.log('Total items to show:', filtered.length);
        }
        
        // Clear and rebuild the list - this removes unchanged items from DOM
        console.log('Clearing changesList DOM...');
        changesList.innerHTML = '';
        
        if (filtered.length === 0) {
            console.log('No filtered items to display');
            const message = currentExcelFilter === 'changes' 
                ? '<p style="text-align: center; padding: 40px; color: #7f8c8d; font-size: 16px;"><strong>✅ No Changes Found!</strong><br>All URLs match and have no DOM differences.</p>'
                : '<p style="text-align: center; padding: 40px; color: #7f8c8d;">No items found</p>';
            changesList.innerHTML = message;
            return;
        }
        
        // Add header showing filter status
        if (currentExcelFilter === 'changes' && filtered.length < excelResults.length) {
            const header = document.createElement('div');
            header.className = 'filter-header';
            header.innerHTML = `<p style="text-align: center; padding: 10px; background: #e3f2fd; border-radius: 4px; margin-bottom: 15px; color: #1976d2;">
                <strong>Showing ${filtered.length} changed items</strong> (${excelResults.length - filtered.length} unchanged items hidden)
            </p>`;
            changesList.appendChild(header);
            console.log('Added filter header');
        }
        
        console.log('Creating change cards for', filtered.length, 'items...');
        filtered.forEach((item, index) => {
            const changeCard = createChangeCard(item);
            changesList.appendChild(changeCard);
        });
        
        console.log('=== RENDER COMPLETE ===');
        console.log('Total cards in DOM:', changesList.children.length);
    }
    
});
