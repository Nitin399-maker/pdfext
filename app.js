// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
// Main application class
class DocumentAnalyzer {
    constructor() {
        this.pdfData = {}; // Will store page numbers and text
        this.form = document.getElementById('document-form');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.loadingText = document.getElementById('loading-text');
        this.loadingProgress = document.getElementById('loading-progress');
        this.pdfInfoCard = document.getElementById('pdf-info-card');
        this.resultsCard = document.getElementById('results-card');
        this.resultsContainer = document.getElementById('results-container'); // Container to show results
        this.themeToggle = document.getElementById('theme-toggle');
        // Bind event listeners
        this.form.addEventListener('submit', this.handleFormSubmit.bind(this));
        this.themeToggle.addEventListener('click', this.toggleDarkMode.bind(this));
        // Initialize variables
        this.totalPages = 0;
        this.processedPages = 0;
        // Initialize theme
        this.initTheme();
    }
    /**
     * Initialize theme based on user preference or system preference
     */
    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-bs-theme', savedTheme);
            this.updateThemeButton(savedTheme);
        } else {
            const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const theme = prefersDarkMode ? 'dark' : 'light';
            document.documentElement.setAttribute('data-bs-theme', theme);
            this.updateThemeButton(theme);
        }
    }
    /**
     * Toggle between light and dark mode
     */
    toggleDarkMode() {
        const currentTheme = document.documentElement.getAttribute('data-bs-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-bs-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        this.updateThemeButton(newTheme);
    }
    /**
     * Update theme toggle button appearance
     * @param {string} theme - Current theme (light/dark)
     */
    updateThemeButton(theme) {
        if (theme === 'dark') {
            this.themeToggle.innerHTML = '<i class="bi bi-sun"></i> Light Mode';
            this.themeToggle.classList.remove('btn-outline-primary');
            this.themeToggle.classList.add('btn-outline-warning');
        } else {
            this.themeToggle.innerHTML = '<i class="bi bi-moon-stars"></i> Dark Mode';
            this.themeToggle.classList.remove('btn-outline-warning');
            this.themeToggle.classList.add('btn-outline-primary');
        }
    }
    /**
     * Handles form submission
     * @param {Event} event - Form submit event
     */
    async handleFormSubmit(event) {
        event.preventDefault();
        // Reset previous results
        this.pdfData = {};
        this.totalPages = 0;
        this.processedPages = 0;
        this.resultsCard.classList.add('d-none');
        this.resultsContainer.innerHTML = ''; // Clear previous displayed results
        // Get form values
        const apiKey = document.getElementById('api-key').value;
        const pdfFile = document.getElementById('pdf-upload').files[0];
        const question = document.getElementById('compliance-question').value;
        const modelSelection = document.getElementById('model-selection').value;
        if (!pdfFile || !question || !apiKey) {
            this.showAlert('Please fill in all required fields', 'danger');
            return;
        }
        try {
            // Show loading overlay
            this.updateProgress(0, 'Processing PDF...');
            // Extract text from PDF
            await this.extractTextFromPDF(pdfFile);
            // Display PDF info
            this.displayPDFInfo(pdfFile.name);
            // Build prompt and send to LLM
            this.updateProgress(85, 'Analyzing with AI...');
            const result = await this.sendToLLM(question, apiKey, modelSelection);
            // Display results
            if (Array.isArray(result)) {
                this.displayMultipleResults(result);
            } else {
                this.displayResults(result);
            }
            this.updateProgress(100, 'Complete!');
        } catch (error) {
            console.error('Error processing document:', error);
            this.showAlert(`Error: ${error.message}`, 'danger');
        } finally {
            this.hideLoading();
        }
    }
    /**
     * Shows a Bootstrap alert
     * @param {string} message - Alert message
     * @param {string} type - Alert type (success, danger, warning, etc.)
     */
    showAlert(message, type) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show py-2 small`;
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        this.form.parentNode.insertBefore(alertDiv, this.form);
        setTimeout(() => {
            alertDiv.classList.remove('show');
            setTimeout(() => alertDiv.remove(), 150);
        }, 5000);
    }
    /**
     * Extracts text from PDF using PDF.js
     * @param {File} pdfFile - The PDF file to process
     */
    async extractTextFromPDF(pdfFile) {
        const arrayBuffer = await this.readFileAsArrayBuffer(pdfFile);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        this.totalPages = pdf.numPages;
        this.processedPages = 0;
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const progress = Math.round((pageNum / pdf.numPages) * 80);
            this.updateProgress(progress, `Processing page ${pageNum} of ${pdf.numPages}...`);
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            this.pdfData[pageNum] = pageText;
            this.processedPages++;
        }
    }
    /**
     * Updates the loading progress bar and message
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} message - Loading message to display
     */
    updateProgress(percent, message) {
        this.loadingProgress.style.width = `${percent}%`;
        this.loadingText.textContent = message;
        this.loadingOverlay.classList.remove('d-none');
    }
    /**
     * Reads a file as ArrayBuffer
     * @param {File} file - The file to read
     * @returns {Promise<ArrayBuffer>} The file contents as ArrayBuffer
     */
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
    /**
     * Sends extracted text to LLM for analysis
     * @param {string} question - The compliance question
     * @param {string} apiKey - OpenRouter API key
     * @param {string} model - The selected model
     * @returns {Promise<Object|Array>} Analysis result or array of chunk results
     */
    async sendToLLM(question, apiKey, model) {
        const shouldProcessInChunks = this.totalPages > 100;
        if (shouldProcessInChunks) {
            return await this.processInChunks(question, apiKey, model);
        } else {
            return await this.processSingleRequest(question, apiKey, model);
        }
    }
    /**
     * Process the document in a single request
     * @param {string} question - The compliance question
     * @param {string} apiKey - OpenRouter API key
     * @param {string} model - The selected model
     * @returns {Promise<Object>} Analysis result
     */
    async processSingleRequest(question, apiKey, model) {
        const prompt = this.buildPrompt(question, this.pdfData);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'Document Compliance Analyzer'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1
            })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }
        const data = await response.json();
        return this.parseResponse(data.choices[0].message.content);
    }
    /**
     * Process the document in chunks for very large documents
     * @param {string} question - The compliance question
     * @param {string} apiKey - OpenRouter API key
     * @param {string} model - The selected model
     * @returns {Promise<Array>} Array of chunk results
     */
    async processInChunks(question, apiKey, model) {
        const chunkSize = 50;
        const chunks = [];
        for (let i = 1; i <= this.totalPages; i += chunkSize) {
            const chunkPages = {};
            const endPage = Math.min(i + chunkSize - 1, this.totalPages);
            for (let page = i; page <= endPage; page++) {
                chunkPages[page] = this.pdfData[page];
            }
            chunks.push(chunkPages);
        }
        let allFindings = [];
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const progress = 85 + Math.round((chunkIndex / chunks.length) * 10);
            this.updateProgress(progress, `Analyzing chunk ${chunkIndex + 1} of ${chunks.length}...`);
            const chunkPrompt = this.buildChunkPrompt(question, chunks[chunkIndex], chunkIndex + 1, chunks.length);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.href,
                    'X-Title': 'Document Compliance Analyzer'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        {
                            role: 'user',
                            content: chunkPrompt
                        }
                    ],
                    temperature: 0.1
                })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
            }
            const data = await response.json();
            const chunkResult = this.parseResponse(data.choices[0].message.content);
            chunkResult.chunkNumber = chunkIndex + 1;
            chunkResult.totalChunks = chunks.length;

            // Enforce correct PDF page_number based on chunk pages
            const chunkPages = Object.keys(chunks[chunkIndex]).map(n => Number(n));
            let reportedPage = chunkResult.page_number;
            let parsedPageNum = parseInt(reportedPage, 10);
            if (isNaN(parsedPageNum) || !chunkPages.includes(parsedPageNum)) {
                chunkResult.page_number = 'N/A';
            } else {
                chunkResult.page_number = parsedPageNum;
            }

            allFindings.push(chunkResult);
        }
        return allFindings;
    }
    /**
     * Builds the prompt for the LLM for a single request
     * @param {string} question - The compliance question
     * @param {Object} pdfData - Pages and their text
     * @returns {string} Formatted prompt
     */
    buildPrompt(question, pdfData) {
        return `
You are a legal document analysis expert. I need you to analyze a PDF document for compliance information.
TASK:
${question}
DOCUMENT TEXT (by page number):
${Object.entries(pdfData).map(([pageNum, text]) =>
            `--- PAGE ${pageNum} ---\n${text.trim()}\n`
        ).join('\n')}
INSTRUCTIONS:
1. Analyze the document to determine the answer to the compliance question.
2. Provide your findings in a JSON format with the following fields:
   - is_subsidiary: "Yes", "No", or "Not Reported"
   - evidence: The exact text from the document that supports your conclusion (direct quote)
   - page_number: The page number where the evidence was found
   - reasoning: Your analysis and reasoning for the conclusion
Return ONLY the JSON response without any other explanation.
`;
    }
    /**
     * Builds the prompt for processing a chunk of the document
     * @param {string} question - The compliance question
     * @param {Object} chunkData - The chunk of pages to analyze
     * @param {number} chunkNum - Current chunk number
     * @param {number} totalChunks - Total number of chunks
     * @returns {string} Formatted prompt
     */
    buildChunkPrompt(question, chunkData, chunkNum, totalChunks) {
        return `
You are a legal document analysis expert. I need you to analyze a portion of a PDF document for compliance information.
TASK:
${question}
IMPORTANT: This is chunk ${chunkNum} of ${totalChunks} from the document. You are only analyzing this portion.
DOCUMENT TEXT (by page number):
${Object.entries(chunkData).map(([pageNum, text]) =>
            `--- PAGE ${pageNum} ---\n${text.trim()}\n`
        ).join('\n')}
INSTRUCTIONS:
1. Analyze this chunk to determine if it contains any information relevant to the compliance question.
2. If you find relevant information, provide your findings in a JSON format with the following fields:
   - is_subsidiary: "Yes", "No", or "Not Reported"
   - evidence: The exact text from the document that supports your conclusion (direct quote)
   - page_number: The page number where the evidence was found
   - reasoning: Your analysis of this evidence
If you find no relevant information in this chunk, set is_subsidiary to "Not Reported", evidence to empty, and explain in reasoning.
Return ONLY the JSON response without any other explanation.
`;
    }
    /**
     * Parses the LLM response into a structured object
     * @param {string} responseText - Raw response from LLM
     * @returns {Object} Structured response object
     */
    parseResponse(responseText) {
        try {
            let jsonStr = responseText;
            if (responseText.includes('```json')) {
                jsonStr = responseText.split('```json')[1].split('```')[0];
            } else if (responseText.includes('```')) {
                jsonStr = responseText.split('```')[1].split('```')[0];
            }
            const result = JSON.parse(jsonStr);
            return {
                is_subsidiary: result.is_subsidiary || 'Not Reported',
                evidence: result.evidence || '',
                page_number: result.page_number || 'N/A',
                reasoning: result.reasoning || ''
            };
        } catch (error) {
            console.error('Error parsing LLM response:', error);
            console.log('Raw response:', responseText);
            return {
                is_subsidiary: 'Error',
                evidence: 'Failed to parse LLM response.',
                page_number: 'N/A',
                reasoning: 'The LLM response could not be properly parsed. Raw response: ' + responseText
            };
        }
    }
    /**
     * Display PDF information
     * @param {string} filename - Name of the PDF file
     */
    displayPDFInfo(filename) {
        document.getElementById('pdf-filename').textContent = filename;
        document.getElementById('pdf-pagecount').textContent = this.totalPages;
        document.getElementById('pdf-processing-mode').textContent =
            this.totalPages > 100 ? 'Chunked' : 'Single';
        this.pdfInfoCard.classList.remove('d-none');
    }
    /**
     * Display a single analysis result
     * @param {Object} result - Analysis result from LLM
     */
    displayResults(result) {
        this.resultsContainer.innerHTML = this.formatSingleResultHtml(result);
        this.resultsCard.classList.remove('d-none');
        const resultTimestamp = document.getElementById('result-timestamp');
        const now = new Date();
        if(resultTimestamp) {
            resultTimestamp.textContent = now.toLocaleTimeString();
        }
    }
    /**
     * Display multiple chunk analysis results
     * @param {Array} resultsArray - Array of chunk results
     */
    displayMultipleResults(resultsArray) {
        let combinedHtml = '';
        const now = new Date();
        resultsArray.forEach((result, index) => {
            combinedHtml += this.formatSingleResultHtml(result, index + 1, resultsArray.length);
        });
        this.resultsContainer.innerHTML = `
            <div class="card-header bg-transparent py-2 border-bottom d-flex justify-content-between align-items-center">
                <h5 class="mb-0 small"><i class="bi bi-clipboard-check me-2 text-primary"></i>Analysis Results (Chunks: ${resultsArray.length})</h5>
                <span id="result-timestamp" class="text-muted small">${now.toLocaleTimeString()}</span>
            </div>
            <div class="card-body p-3">
                ${combinedHtml}
            </div>
        `;
        this.resultsCard.classList.remove('d-none');
    }
    /**
     * Helper to generate HTML for a single result chunk
     * @param {Object} result - Result object
     * @param {number} [chunkNumber] - Optional chunk number for display
     * @param {number} [totalChunks] - Optional total chunks
     * @returns {string} HTML string for a single result block
     */
    formatSingleResultHtml(result, chunkNumber = null, totalChunks = null) {
        let badgeClass = 'bg-secondary';
        let iconClass = 'bi-dash-circle';
        if (result.is_subsidiary === 'Yes') {
            badgeClass = 'bg-success';
            iconClass = 'bi-check-circle';
        } else if (result.is_subsidiary === 'No') {
            badgeClass = 'bg-danger';
            iconClass = 'bi-x-circle';
        } else if (result.is_subsidiary === 'Error') {
            badgeClass = 'bg-warning text-dark';
            iconClass = 'bi-exclamation-triangle';
        }
        const chunkHeader = chunkNumber !== null && totalChunks !== null
            ? `<h6 class="mb-3 small text-primary">Chunk ${chunkNumber} of ${totalChunks}</h6>`
            : '';
        let formattedReasoning = '<p>No detailed reasoning provided.</p>';
        if (result.reasoning) {
            formattedReasoning = result.reasoning
                .split('\n')
                .map(para => para.trim())
                .filter(para => para.length > 0)
                .map(para => `<p class="mb-1">${para}</p>`)
                .join('');
        }
        return `
            <div class="mb-4 border-bottom pb-3">
                ${chunkHeader}
                <div class="mb-3 text-center">
                    <h6 class="mb-2 small">Compliance Status</h6>
                    <span class="badge rounded-pill px-3 py-2 ${badgeClass}">
                        <i class="bi ${iconClass} me-1"></i>${result.is_subsidiary}
                    </span>
                </div>
                <div class="mb-3">
                    <h6 class="mb-2 small">Evidence</h6>
                    <div class="p-2 bg-body-secondary rounded-2 border-start border-3 border-primary fst-italic small">${result.evidence || 'No specific evidence provided.'}</div>
                    <div class="text-end mt-1">
                        <span class="badge bg-secondary small">
                            Page ${result.page_number}
                        </span>
                    </div>
                </div>

            </div>
        `;
    }
    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.loadingOverlay.classList.add('d-none');
    }
}
// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new DocumentAnalyzer();
});